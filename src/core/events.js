'use strict';

const EventEmitter = require('events');

// Shared event bus. Web panel (and later the Discord bot) subscribe to this
// to receive status/log updates without tight coupling to the monitoring code.
const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = bus;
