'use strict';

const utils = require('@iobroker/adapter-core');

class Stoerungsmanager extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'stoerungsmanager' });
        this.subscriptions = new Map();
        this.faultBySource = new Map();
        this.faultByState = new Map();

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync('info.connection', true, true);
        await this.initializeFaults();
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
        return `${this.rootPath()}.${this.normalizeId(fault.id || fault.melder || fault.meldetext)}`;
    }

    async initializeFaults() {
        const faults = Array.isArray(this.config.faults) ? this.config.faults : [];

        for (const fault of faults) {
            if (fault.enabled === false || !fault.sourceId) continue;

            const normalized = {
                ...fault,
                id: this.normalizeId(fault.id || fault.melder || fault.meldetext)
            };
            const path = this.faultPath(normalized);
            const stateId = `${path}.Meldezustand`;

            await this.ensureFaultObjects(normalized);
            this.faultBySource.set(normalized.sourceId, normalized);
            this.faultByState.set(stateId, normalized);
            await this.subscribeForeignStatesAsync(normalized.sourceId);
            await this.subscribeForeignStatesAsync(stateId);

            const sourceState = await this.getForeignStateAsync(normalized.sourceId);
            if (sourceState) await this.evaluateFault(normalized, sourceState.val, false);
            else this.log.warn(`Auslöser nicht gefunden: ${normalized.sourceId}`);
        }

        this.log.info(`${this.faultBySource.size} Störung(en) werden überwacht.`);
    }

    async ensureForeignState(id, common, initialValue) {
        const object = await this.getForeignObjectAsync(id);
        if (!object) {
            await this.setForeignObjectAsync(id, {
                type: 'state',
                common,
                native: {}
            });
            await this.setForeignStateAsync(id, { val: initialValue, ack: true });
        }
    }

    async ensureFaultObjects(fault) {
        const path = this.faultPath(fault);
        await this.ensureForeignState(`${path}.Ausloeser`, {
            name: 'Auslöser', type: 'string', role: 'text', read: true, write: false
        }, fault.sourceId);
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

        await this.setForeignStateAsync(`${path}.Ausloeser`, { val: fault.sourceId, ack: true });
        await this.setForeignStateAsync(`${path}.Meldegruppe`, { val: fault.meldegruppe || 'Allgemein', ack: true });
        await this.setForeignStateAsync(`${path}.Melder`, { val: fault.melder || fault.id, ack: true });
        await this.setForeignStateAsync(`${path}.Meldetext`, { val: fault.meldetext || fault.id, ack: true });
    }

    compare(actual, operator, expected) {
        switch (operator) {
            case 'true': return actual === true || actual === 1 || actual === 'true' || actual === '1';
            case 'false': return actual === false || actual === 0 || actual === 'false' || actual === '0';
            case 'truthy': return Boolean(actual);
            case 'falsy': return !actual;
            case 'eq': return String(actual) === String(expected);
            case 'neq': return String(actual) !== String(expected);
            case 'gt': return Number(actual) > Number(expected);
            case 'gte': return Number(actual) >= Number(expected);
            case 'lt': return Number(actual) < Number(expected);
            case 'lte': return Number(actual) <= Number(expected);
            case 'contains': return String(actual).includes(String(expected));
            default: return false;
        }
    }

    async evaluateFault(fault, sourceValue, sendNotification = true) {
        const active = this.compare(sourceValue, fault.operator || 'true', fault.compareValue);
        const stateId = `${this.faultPath(fault)}.Meldezustand`;
        const current = Number((await this.getForeignStateAsync(stateId))?.val ?? 0);
        let next = current;

        if (active && current === 0) next = 1;
        if (!active && current !== 0) next = 0;

        if (next !== current) {
            await this.setForeignStateAsync(stateId, { val: next, ack: true });
            if (sendNotification) await this.notify(fault, current, next, sourceValue);
        }
    }

    async handleAcknowledgement(fault, state) {
        if (state.ack || Number(state.val) !== 2) return;
        const source = await this.getForeignStateAsync(fault.sourceId);
        const active = source && this.compare(source.val, fault.operator || 'true', fault.compareValue);
        const stateId = `${this.faultPath(fault)}.Meldezustand`;

        if (active) {
            const previous = Number((await this.getForeignStateAsync(stateId))?.val ?? 1);
            await this.setForeignStateAsync(stateId, { val: 2, ack: true });
            await this.notify(fault, previous, 2, source.val);
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

    async collectInfo(fault, oldState, newState, sourceValue) {
        return {
            id: fault.id,
            ausloeser: fault.sourceId,
            ausloeserWert: sourceValue,
            meldegruppe: fault.meldegruppe || 'Allgemein',
            melder: fault.melder || fault.id,
            meldetext: fault.meldetext || fault.id,
            vorherigerZustand: this.stateText(oldState),
            meldezustand: this.stateText(newState),
            zeitpunkt: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Vienna' })
        };
    }

    formatMessage(info) {
        const symbol = info.meldezustand === 'Störung aktiv' ? '🚨' : info.meldezustand === 'Störung quittiert' ? '☑️' : '✅';
        return [
            `${symbol} Störmeldung im Haus`, '',
            `Meldetext: ${info.meldetext}`,
            `Meldegruppe: ${info.meldegruppe}`,
            `Melder: ${info.melder}`, '',
            `Zustand: ${info.meldezustand}`,
            `Vorheriger Zustand: ${info.vorherigerZustand}`, '',
            `Auslöser: ${info.ausloeser}`,
            `Auslöserwert: ${String(info.ausloeserWert)}`, '',
            `Störungs-ID: ${info.id}`,
            `Zeitpunkt: ${info.zeitpunkt}`
        ].join('\n');
    }

    async notify(fault, oldState, newState, sourceValue) {
        if (!this.shouldNotify(newState)) return;
        const info = await this.collectInfo(fault, oldState, newState, sourceValue);
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
        const sourceFault = this.faultBySource.get(id);
        if (sourceFault) await this.evaluateFault(sourceFault, state.val, true);

        const stateFault = this.faultByState.get(id);
        if (stateFault) await this.handleAcknowledgement(stateFault, state);
    }

    onMessage(obj) {
        if (!obj || !obj.callback) return;
        if (obj.command === 'testNotification') {
            const sample = {
                id: 'Testmeldung', sourceId: 'system.adapter.stoerungsmanager.0.alive',
                meldegruppe: 'Test', melder: 'Störungsmanager', meldetext: 'Dies ist eine Testmeldung'
            };
            this.notify(sample, 0, 1, true)
                .then(() => this.sendTo(obj.from, obj.command, { success: true }, obj.callback))
                .catch(error => this.sendTo(obj.from, obj.command, { success: false, error: String(error) }, obj.callback));
        }
    }

    async onUnload(callback) {
        try {
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
