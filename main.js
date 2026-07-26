'use strict';

const utils = require('@iobroker/adapter-core');

class Stoerungsmanager extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'stoerungsmanager' });
        this.faults = new Map();
        this.conditions = new Map();
        this.conditionsBySource = new Map();
        this.faultByState = new Map();
        this.durationTimers = new Map();
        this.timeoutTimers = new Map();
        this.pulseTimers = new Map();

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    normalizeId(value) {
        return String(value || '')
            .trim()
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '') || 'Stoerung';
    }

    rootPath() {
        return String(this.config.rootPath || '0_userdata.0.Stoerungen').replace(/\.+$/, '');
    }

    faultPath(fault) {
        return `${this.rootPath()}.${fault.id}`;
    }

    conditionKey(faultId, conditionId) {
        return `${faultId}::${conditionId}`;
    }

    async onReady() {
        await this.setStateAsync('info.connection', true, true);
        await this.initializeRules();
    }

    async initializeRules() {
        const configuredFaults = Array.isArray(this.config.faults) ? this.config.faults : [];
        let configuredConditions = Array.isArray(this.config.conditions) ? this.config.conditions : [];

        // Migration von Version 0.1.x: bisherige Einzelbedingungen aus der Störungstabelle übernehmen.
        if (configuredConditions.length === 0) {
            configuredConditions = configuredFaults
                .filter(fault => fault.sourceId)
                .map(fault => ({
                    enabled: fault.enabled !== false,
                    faultId: fault.id || fault.melder || fault.meldetext,
                    id: 'Bedingung_1',
                    sourceId: fault.sourceId,
                    operator: fault.operator || 'true',
                    compareValue: fault.compareValue ?? '',
                    compareValue2: '',
                    regexFlags: '',
                    durationSec: 0,
                    timeoutSec: 600,
                    pulseSec: 1,
                    communicationMonitoring: false,
                    communicationTimeoutSec: 600
                }));
            if (configuredConditions.length > 0) {
                this.log.info(`${configuredConditions.length} bestehende Einzelbedingung(en) aus Version 0.1.x wurden übernommen.`);
            }
        }

        for (const rawFault of configuredFaults) {
            if (rawFault.enabled === false) continue;
            const id = this.normalizeId(rawFault.id || rawFault.melder || rawFault.meldetext);
            const fault = {
                ...rawFault,
                id,
                logic: rawFault.logic === 'OR' ? 'OR' : 'AND',
                conditions: []
            };
            this.faults.set(id, fault);
            this.faultByState.set(`${this.faultPath(fault)}.Meldezustand`, fault);
        }

        for (let index = 0; index < configuredConditions.length; index++) {
            const rawCondition = configuredConditions[index];
            if (rawCondition.enabled === false) continue;
            const faultId = this.normalizeId(rawCondition.faultId);
            const fault = this.faults.get(faultId);
            if (!fault) {
                this.log.warn(`Bedingung verweist auf unbekannte Störungs-ID: ${rawCondition.faultId}`);
                continue;
            }

            const conditionId = this.normalizeId(rawCondition.id || `Bedingung_${index + 1}`);
            const key = this.conditionKey(faultId, conditionId);
            const condition = {
                ...rawCondition,
                id: conditionId,
                faultId,
                key,
                operator: rawCondition.operator || 'true',
                durationSec: Math.max(0, Number(rawCondition.durationSec) || 0),
                // timeoutSec bleibt ausschließlich für die Migration alter 0.2-Konfigurationen erhalten.
                timeoutSec: Math.max(1, Number(rawCondition.timeoutSec) || 60),
                pulseSec: Math.max(1, Number(rawCondition.pulseSec) || 1),
                communicationMonitoring: rawCondition.communicationMonitoring === true,
                communicationTimeoutSec: Math.max(1, Number(rawCondition.communicationTimeoutSec) || 600),
                latestState: null,
                previousValue: undefined,
                rawMatch: false,
                communicationTimedOut: false,
                effectiveMatch: false,
                initialized: false,
                lastUpdate: 0
            };

            fault.conditions.push(condition);
            this.conditions.set(key, condition);

            if (condition.sourceId) {
                if (!this.conditionsBySource.has(condition.sourceId)) {
                    this.conditionsBySource.set(condition.sourceId, new Set());
                }
                this.conditionsBySource.get(condition.sourceId).add(key);
            }
        }

        for (const fault of this.faults.values()) {
            await this.ensureFaultObjects(fault);
            await this.subscribeForeignStatesAsync(`${this.faultPath(fault)}.Meldezustand`);

            if (fault.conditions.length === 0) {
                this.log.warn(`Störung ${fault.id} besitzt keine aktive Bedingung.`);
                continue;
            }

            for (const condition of fault.conditions) {
                if (!condition.sourceId) {
                    this.log.warn(`Bedingung ${condition.id} der Störung ${fault.id} hat keinen Auslöser.`);
                    continue;
                }
                await this.subscribeForeignStatesAsync(condition.sourceId);
                const sourceState = await this.getForeignStateAsync(condition.sourceId);
                if (sourceState) {
                    await this.processConditionState(condition, sourceState, false, true);
                } else {
                    this.log.warn(`Auslöser nicht gefunden: ${condition.sourceId}`);
                    if (condition.operator === 'timeout') this.armTimeout(condition);
                    if (condition.communicationMonitoring) this.armCommunicationTimeout(condition);
                }
            }

            await this.evaluateFault(fault, false);
        }

        this.log.info(`${this.faults.size} Störung(en) mit ${this.conditions.size} Bedingung(en) werden überwacht.`);
    }

    async ensureForeignState(id, common, initialValue) {
        const object = await this.getForeignObjectAsync(id);
        if (!object) {
            await this.setForeignObjectAsync(id, { type: 'state', common, native: {} });
            await this.setForeignStateAsync(id, { val: initialValue, ack: true });
        }
    }

    async ensureFaultObjects(fault) {
        const path = this.faultPath(fault);
        const sources = [...new Set(fault.conditions.map(condition => condition.sourceId).filter(Boolean))].join(', ');
        const details = this.conditionDetails(fault);

        await this.ensureForeignState(`${path}.Ausloeser`, {
            name: 'Auslöser', type: 'string', role: 'text', read: true, write: false
        }, sources);
        await this.ensureForeignState(`${path}.Meldegruppe`, {
            name: 'Meldegruppe', type: 'string', role: 'text', read: true, write: false
        }, fault.meldegruppe || 'Allgemein');
        await this.ensureForeignState(`${path}.Melder`, {
            name: 'Melder', type: 'string', role: 'text', read: true, write: false
        }, fault.melder || fault.id);
        await this.ensureForeignState(`${path}.Meldetext`, {
            name: 'Meldetext', type: 'string', role: 'text', read: true, write: false
        }, fault.meldetext || fault.id);
        await this.ensureForeignState(`${path}.Meldezustand`, {
            name: 'Meldezustand', type: 'number', role: 'value', read: true, write: true,
            min: 0, max: 2,
            states: { 0: 'Keine Störung', 1: 'Störung aktiv', 2: 'Störung quittiert' }
        }, 0);
        await this.ensureForeignState(`${path}.Bedingungsdetails`, {
            name: 'Bedingungsdetails', type: 'string', role: 'json', read: true, write: false
        }, JSON.stringify(details));

        await this.setForeignStateAsync(`${path}.Ausloeser`, { val: sources, ack: true });
        await this.setForeignStateAsync(`${path}.Meldegruppe`, { val: fault.meldegruppe || 'Allgemein', ack: true });
        await this.setForeignStateAsync(`${path}.Melder`, { val: fault.melder || fault.id, ack: true });
        await this.setForeignStateAsync(`${path}.Meldetext`, { val: fault.meldetext || fault.id, ack: true });
        await this.setForeignStateAsync(`${path}.Bedingungsdetails`, { val: JSON.stringify(details), ack: true });
    }

    parseComparable(value) {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
        return value;
    }

    valuesEqual(actual, expected) {
        const parsedExpected = this.parseComparable(expected);
        if (typeof actual === 'number' && typeof parsedExpected === 'number') return actual === parsedExpected;
        if (typeof actual === 'boolean' && typeof parsedExpected === 'boolean') return actual === parsedExpected;
        return String(actual) === String(parsedExpected);
    }

    compareValue(condition, actual, previousValue) {
        const expected = condition.compareValue;
        const expected2 = condition.compareValue2;

        switch (condition.operator) {
            case 'true': return actual === true || actual === 1 || actual === 'true' || actual === '1';
            case 'false': return actual === false || actual === 0 || actual === 'false' || actual === '0';
            case 'eq': return this.valuesEqual(actual, expected);
            case 'neq': return !this.valuesEqual(actual, expected);
            case 'gt': return Number(actual) > Number(expected);
            case 'gte': return Number(actual) >= Number(expected);
            case 'lt': return Number(actual) < Number(expected);
            case 'lte': return Number(actual) <= Number(expected);
            case 'between': {
                const min = Math.min(Number(expected), Number(expected2));
                const max = Math.max(Number(expected), Number(expected2));
                return Number(actual) >= min && Number(actual) <= max;
            }
            case 'outside': {
                const min = Math.min(Number(expected), Number(expected2));
                const max = Math.max(Number(expected), Number(expected2));
                return Number(actual) < min || Number(actual) > max;
            }
            case 'contains': return String(actual).includes(String(expected));
            case 'notContains': return !String(actual).includes(String(expected));
            case 'regex': {
                try {
                    return new RegExp(String(expected), condition.regexFlags || '').test(String(actual));
                } catch (error) {
                    this.log.warn(`Ungültiger Regex in ${condition.faultId}/${condition.id}: ${error.message}`);
                    return false;
                }
            }
            case 'change': return condition.initialized && !this.valuesEqual(actual, previousValue);
            case 'rising': return condition.initialized && this.isZero(previousValue) && this.isOne(actual);
            case 'falling': return condition.initialized && this.isOne(previousValue) && this.isZero(actual);
            case 'timeout': return false;
            default: return false;
        }
    }

    isZero(value) {
        return value === false || value === 0 || value === '0' || value === 'false';
    }

    isOne(value) {
        return value === true || value === 1 || value === '1' || value === 'true';
    }

    isPulseOperator(operator) {
        return operator === 'change' || operator === 'rising' || operator === 'falling';
    }

    async processConditionState(condition, state, notify = true, initial = false) {
        const previousValue = condition.previousValue;
        condition.latestState = state;
        condition.lastUpdate = Date.now();

        // Jede Zustandsaktualisierung bestätigt die Kommunikation und startet den optionalen Timer neu.
        if (condition.communicationMonitoring) {
            condition.communicationTimedOut = false;
            this.armCommunicationTimeout(condition);
        }

        // Unterstützung bestehender 0.2-Konfigurationen mit dem früheren Operator "timeout".
        if (condition.operator === 'timeout') {
            condition.rawMatch = false;
            condition.communicationTimedOut = false;
            condition.effectiveMatch = false;
            condition.previousValue = state.val;
            condition.initialized = true;
            this.armTimeout(condition);
            await this.evaluateFault(this.faults.get(condition.faultId), notify);
            return;
        }

        const match = initial && this.isPulseOperator(condition.operator)
            ? false
            : this.compareValue(condition, state.val, previousValue);

        condition.previousValue = state.val;
        condition.initialized = true;
        await this.applyRawConditionResult(condition, match, notify);

        if (match && this.isPulseOperator(condition.operator)) {
            this.armPulseReset(condition);
        }
    }

    async applyRawConditionResult(condition, match, notify) {
        condition.rawMatch = Boolean(match);
        const timer = this.durationTimers.get(condition.key);

        // Ein Kommunikations-Timeout löst unabhängig vom Wertevergleich sofort aus.
        if (condition.communicationTimedOut) {
            if (timer) clearTimeout(timer);
            this.durationTimers.delete(condition.key);
            if (!condition.effectiveMatch) {
                condition.effectiveMatch = true;
                await this.evaluateFault(this.faults.get(condition.faultId), notify);
            } else {
                await this.updateConditionDetails(this.faults.get(condition.faultId));
            }
            return;
        }

        if (!condition.rawMatch) {
            if (timer) clearTimeout(timer);
            this.durationTimers.delete(condition.key);
            if (condition.effectiveMatch) {
                condition.effectiveMatch = false;
                await this.evaluateFault(this.faults.get(condition.faultId), notify);
            } else {
                await this.updateConditionDetails(this.faults.get(condition.faultId));
            }
            return;
        }

        if (condition.durationSec > 0 && !condition.effectiveMatch) {
            if (!timer) {
                this.durationTimers.set(condition.key, setTimeout(async () => {
                    this.durationTimers.delete(condition.key);
                    if (condition.rawMatch && !condition.communicationTimedOut) {
                        condition.effectiveMatch = true;
                        await this.evaluateFault(this.faults.get(condition.faultId), true);
                    }
                }, condition.durationSec * 1000));
            }
            await this.updateConditionDetails(this.faults.get(condition.faultId));
            return;
        }

        if (!condition.effectiveMatch) {
            condition.effectiveMatch = true;
            await this.evaluateFault(this.faults.get(condition.faultId), notify);
        } else {
            await this.updateConditionDetails(this.faults.get(condition.faultId));
        }
    }

    armTimeout(condition) {
        const oldTimer = this.timeoutTimers.get(condition.key);
        if (oldTimer) clearTimeout(oldTimer);
        condition.effectiveMatch = false;
        this.timeoutTimers.set(condition.key, setTimeout(async () => {
            this.timeoutTimers.delete(condition.key);
            condition.rawMatch = true;
            condition.effectiveMatch = true;
            await this.evaluateFault(this.faults.get(condition.faultId), true);
        }, condition.timeoutSec * 1000));
    }

    armCommunicationTimeout(condition) {
        const oldTimer = this.timeoutTimers.get(`communication::${condition.key}`);
        if (oldTimer) clearTimeout(oldTimer);

        this.timeoutTimers.set(`communication::${condition.key}`, setTimeout(async () => {
            this.timeoutTimers.delete(`communication::${condition.key}`);
            condition.communicationTimedOut = true;
            condition.effectiveMatch = true;
            await this.evaluateFault(this.faults.get(condition.faultId), true);
        }, condition.communicationTimeoutSec * 1000));
    }

    armPulseReset(condition) {
        const oldTimer = this.pulseTimers.get(condition.key);
        if (oldTimer) clearTimeout(oldTimer);
        this.pulseTimers.set(condition.key, setTimeout(async () => {
            this.pulseTimers.delete(condition.key);
            await this.applyRawConditionResult(condition, false, true);
        }, condition.pulseSec * 1000));
    }

    faultIsActive(fault) {
        if (!fault || fault.conditions.length === 0) return false;
        return fault.logic === 'OR'
            ? fault.conditions.some(condition => condition.effectiveMatch)
            : fault.conditions.every(condition => condition.effectiveMatch);
    }

    async evaluateFault(fault, sendNotification = true) {
        if (!fault) return;
        const active = this.faultIsActive(fault);
        const stateId = `${this.faultPath(fault)}.Meldezustand`;
        const current = Number((await this.getForeignStateAsync(stateId))?.val ?? 0);
        let next = current;

        if (active && current === 0) next = 1;
        if (!active && current !== 0) next = 0;

        await this.updateConditionDetails(fault);

        if (next !== current) {
            await this.setForeignStateAsync(stateId, { val: next, ack: true });
            if (sendNotification) await this.notify(fault, current, next);
        }
    }

    async updateConditionDetails(fault) {
        if (!fault) return;
        const id = `${this.faultPath(fault)}.Bedingungsdetails`;
        await this.setForeignStateAsync(id, { val: JSON.stringify(this.conditionDetails(fault)), ack: true });
    }

    conditionDetails(fault) {
        return fault.conditions.map(condition => ({
            id: condition.id,
            ausloeser: condition.sourceId,
            bedingung: condition.operator,
            vergleichswert: condition.compareValue ?? '',
            vergleichswert2: condition.compareValue2 ?? '',
            wert: condition.latestState?.val ?? null,
            erfuellt: condition.effectiveMatch,
            rohErfuellt: condition.rawMatch,
            letzteAenderung: condition.latestState?.lc || condition.latestState?.ts || null,
            timeoutSekunden: condition.operator === 'timeout' ? condition.timeoutSec : 0,
            kommunikationsueberwachung: condition.communicationMonitoring,
            kommunikationsTimeoutSekunden: condition.communicationMonitoring ? condition.communicationTimeoutSec : 0,
            kommunikationsTimeoutAktiv: condition.communicationTimedOut,
            verzoegerungSekunden: condition.durationSec
        }));
    }

    async handleAcknowledgement(fault, state) {
        if (state.ack || Number(state.val) !== 2) return;
        const stateId = `${this.faultPath(fault)}.Meldezustand`;
        const active = this.faultIsActive(fault);

        if (active) {
            const previous = Number((await this.getForeignStateAsync(stateId))?.val ?? 1);
            await this.setForeignStateAsync(stateId, { val: 2, ack: true });
            await this.notify(fault, previous, 2);
        } else {
            await this.setForeignStateAsync(stateId, { val: 0, ack: true });
        }
    }

    shouldNotify(state) {
        return (state === 1 && this.config.notifyActive !== false) ||
            (state === 2 && this.config.notifyAcknowledged !== false) ||
            (state === 0 && this.config.notifyCleared !== false);
    }

    stateText(state) {
        return state === 1 ? 'Störung aktiv' : state === 2 ? 'Störung quittiert' : 'Störung behoben';
    }

    operatorText(operator) {
        const labels = {
            true: 'ist wahr', false: 'ist falsch', eq: '=', neq: '≠', gt: '>', gte: '≥',
            lt: '<', lte: '≤', between: 'zwischen', outside: 'außerhalb', contains: 'enthält',
            notContains: 'enthält nicht', regex: 'Regex', change: 'Änderung', rising: 'Flanke 0→1',
            falling: 'Flanke 1→0', timeout: 'Timeout'
        };
        return labels[operator] || operator;
    }

    async collectInfo(fault, oldState, newState) {
        return {
            id: fault.id,
            meldegruppe: fault.meldegruppe || 'Allgemein',
            melder: fault.melder || fault.id,
            meldetext: fault.meldetext || fault.id,
            logik: fault.logic,
            vorherigerZustand: this.stateText(oldState),
            meldezustand: this.stateText(newState),
            zeitpunkt: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
            bedingungen: fault.conditions.map(condition => ({
                id: condition.id,
                ausloeser: condition.sourceId,
                operator: this.operatorText(condition.operator),
                vergleich: condition.operator === 'between' || condition.operator === 'outside'
                    ? `${condition.compareValue} … ${condition.compareValue2}`
                    : condition.operator === 'timeout'
                        ? `${condition.timeoutSec} Sekunden`
                        : condition.compareValue ?? '',
                wert: condition.latestState?.val ?? 'nicht vorhanden',
                erfuellt: condition.effectiveMatch,
                kommunikationsueberwachung: condition.communicationMonitoring,
                kommunikationsTimeoutSekunden: condition.communicationTimeoutSec,
                kommunikationsTimeoutAktiv: condition.communicationTimedOut
            }))
        };
    }

    formatMessage(info) {
        const symbol = info.meldezustand === 'Störung aktiv' ? '🚨' : info.meldezustand === 'Störung quittiert' ? '☑️' : '✅';
        const lines = [
            `${symbol} Störmeldung im Haus`, '',
            `Meldetext: ${info.meldetext}`,
            `Meldegruppe: ${info.meldegruppe}`,
            `Melder: ${info.melder}`, '',
            `Zustand: ${info.meldezustand}`,
            `Vorheriger Zustand: ${info.vorherigerZustand}`,
            `Regelverknüpfung: ${info.logik}`, '',
            'Bedingungen:'
        ];

        for (const condition of info.bedingungen) {
            lines.push(
                `- ${condition.id}: ${condition.ausloeser}`,
                `  Bedingung: ${condition.operator}${condition.vergleich !== '' ? ` ${condition.vergleich}` : ''}`,
                `  Aktueller Wert: ${String(condition.wert)}`,
                `  Erfüllt: ${condition.erfuellt ? 'Ja' : 'Nein'}`
            );
            if (condition.kommunikationsueberwachung) {
                lines.push(
                    `  Kommunikationsüberwachung: ${condition.kommunikationsTimeoutSekunden} s`,
                    `  Kommunikations-Timeout: ${condition.kommunikationsTimeoutAktiv ? 'Ja' : 'Nein'}`
                );
            }
        }

        lines.push('', `Störungs-ID: ${info.id}`, `Zeitpunkt: ${info.zeitpunkt}`);
        return lines.join('\n');
    }

    async notify(fault, oldState, newState) {
        if (!this.shouldNotify(newState)) return;
        const info = await this.collectInfo(fault, oldState, newState);
        const text = this.formatMessage(info);

        if (this.config.telegramEnabled && this.config.telegramInstance) {
            const message = { text };
            if (this.config.telegramUser) message.user = this.config.telegramUser;
            this.sendTo(this.config.telegramInstance, 'send', message);
        }

        if (this.config.emailEnabled && this.config.emailInstance && this.config.emailRecipient) {
            this.sendTo(this.config.emailInstance, {
                to: this.config.emailRecipient,
                subject: `${this.config.emailSubjectPrefix || '[Haus]'} ${info.meldezustand}: ${info.meldetext}`,
                text
            });
        }

        this.log.info(`${info.meldezustand}: ${info.meldetext}`);
    }

    async onStateChange(id, state) {
        if (!state) return;

        const conditionKeys = this.conditionsBySource.get(id);
        if (conditionKeys) {
            for (const key of conditionKeys) {
                const condition = this.conditions.get(key);
                if (condition) await this.processConditionState(condition, state, true, false);
            }
        }

        const fault = this.faultByState.get(id);
        if (fault) await this.handleAcknowledgement(fault, state);
    }

    onMessage(obj) {
        if (!obj || !obj.callback) return;
        if (obj.command === 'testNotification') {
            const sample = {
                id: 'Testmeldung', meldegruppe: 'Test', melder: 'Störungsmanager',
                meldetext: 'Dies ist eine Testmeldung', logic: 'AND',
                conditions: [{
                    id: 'Testbedingung', sourceId: 'system.adapter.stoerungsmanager.0.alive',
                    operator: 'true', compareValue: '', latestState: { val: true }, effectiveMatch: true
                }]
            };
            this.notify(sample, 0, 1)
                .then(() => this.sendTo(obj.from, obj.command, { success: true }, obj.callback))
                .catch(error => this.sendTo(obj.from, obj.command, { success: false, error: String(error) }, obj.callback));
        }
    }

    clearTimers(map) {
        for (const timer of map.values()) clearTimeout(timer);
        map.clear();
    }

    async onUnload(callback) {
        try {
            this.clearTimers(this.durationTimers);
            this.clearTimers(this.timeoutTimers);
            this.clearTimers(this.pulseTimers);
            await this.setStateAsync('info.connection', false, true);
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new Stoerungsmanager(options);
} else {
    new Stoerungsmanager();
}
