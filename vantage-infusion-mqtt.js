/**
 * Vantage InFusion to MQTT Bridge Node for Node-RED
 * Author: Bruno Leonardi
 * License: MIT
 */

const proto = require("./vantage-protocol.js");

module.exports = function (RED) {
    function VantageInfusionMqttNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;

        node.controller = RED.nodes.getNode(n.controller);
        node.load = n.load || "";
        node.load_sync = n.load_sync !== false;
        node.blind = n.blind || "";
        node.blind_sync = n.blind_sync !== false;
        node.sensor = n.sensor || "";
        node.sensor_sync = n.sensor_sync !== false;
        node.variable = n.variable || "";
        node.variable_sync = n.variable_sync !== false;
        node.buttons_string = n.buttons_string || "";
        node.button_sync = n.button_sync || false;
        node.task = n.task || "";
        node.task_sync = n.task_sync !== false;
        node.thermostat = n.thermostat || "";
        node.thermostat_sync = n.thermostat_sync !== false;
        node.led = n.led || "";
        node.led_sync = n.led_sync !== false;
        node.sync_startup = n.sync_startup !== false;
        node.sync_period = parseInt(n.sync_period, 10) || 0;
        node.watchdog = n.watchdog !== false;
        node.mqtt_discovery = n.mqtt_discovery || false;
        node.discovery_prefix = n.discovery_prefix || "homeassistant";
        node.debug = n.debug || false;

        let syncIntervalTimer = null;
        let watchdogTimer = null;
        let lastActivity = Date.now();

        const options = {
            load: node.load,
            load_sync: node.load_sync,
            blind: node.blind,
            blind_sync: node.blind_sync,
            sensor: node.sensor,
            sensor_sync: node.sensor_sync,
            variable: node.variable,
            variable_sync: node.variable_sync,
            buttons_string: node.buttons_string,
            button_sync: node.button_sync,
            task: node.task,
            task_sync: node.task_sync,
            thermostat: node.thermostat,
            thermostat_sync: node.thermostat_sync,
            led: node.led,
            led_sync: node.led_sync,
            discoveryPrefix: node.discovery_prefix
        };

        function log(msg) {
            if (node.debug) node.log(msg);
        }

        function sendConnectionStatus(stateStr) {
            const update = {
                state: stateStr,
                attributes: {
                    manufacturer: proto.MANUFACTURER,
                    powered_by: proto.POWERED_BY,
                    function: "Connection status",
                    controller_version: (node.controller && node.controller.controllerVersion) ? node.controller.controllerVersion : "unknown"
                }
            };
            node.send([
                {
                    topic: proto.TOPIC_CONNECTION_STATUS,
                    payload: JSON.stringify(update),
                    qos: 0,
                    retain: true
                },
                null
            ]);
        }

        function publishDiscovery() {
            if (!node.mqtt_discovery) return;
            const msgs = proto.buildDiscoveryMessages(options);
            log(`Publishing ${msgs.length} Home Assistant Auto-Discovery messages...`);
            for (const m of msgs) {
                node.send([m, null]);
            }
        }

        function performSync() {
            if (!node.controller || !node.controller.connected) return;
            log("Starting synchronization of configured entities...");
            const syncCmds = proto.buildSyncRequests(options);
            for (const cmd of syncCmds) {
                node.controller.sendCommand(cmd);
            }
        }

        function resetButtons() {
            if (!node.button_sync || !node.controller) return;
            const btns = proto.parseIdList(node.buttons_string);
            for (const vid of btns) {
                node.controller.sendCommand(`BTNRELEASE ${vid}`);
                // Also send synthetic event locally to MQTT
                const syntheticEvent = `R:BTN ${vid} RELEASE`;
                const parsed = proto.parseVantageEvent(syntheticEvent, node.controller.controllerVersion);
                if (parsed) {
                    node.send([parsed.mqttMessage, null]);
                }
            }
        }

        // Listener references for clean unbinding
        let onDataHandler = null;
        let onConnectedHandler = null;
        let onDisconnectedHandler = null;
        let onStatusHandler = null;

        if (node.controller) {
            onDataHandler = function (line) {
                lastActivity = Date.now();

                // Output 2: Raw Vantage string as-is
                const rawMsg = {
                    topic: "vantage/raw/event",
                    payload: line
                };

                // Output 1: Formatted MQTT JSON message
                const parsed = proto.parseVantageEvent(line, node.controller.controllerVersion);
                if (parsed) {
                    if (parsed.type === "version" && parsed.version) {
                        node.controller.controllerVersion = parsed.version;
                    }
                    node.send([parsed.mqttMessage, rawMsg]);
                    node.status({ fill: "green", shape: "dot", text: parsed.statusText });
                } else {
                    node.send([null, rawMsg]);
                }
            };

            onConnectedHandler = function () {
                sendConnectionStatus("ON");
                publishDiscovery();
                resetButtons();

                if (node.sync_startup) {
                    setTimeout(() => {
                        performSync();
                    }, 3000);
                }
            };

            onDisconnectedHandler = function () {
                sendConnectionStatus("OFF");
            };

            onStatusHandler = function (s) {
                node.status(s);
            };

            node.controller.eventEmitter.on("data", onDataHandler);
            node.controller.eventEmitter.on("connected", onConnectedHandler);
            node.controller.eventEmitter.on("disconnected", onDisconnectedHandler);
            node.controller.eventEmitter.on("status", onStatusHandler);

            // Initial state check
            if (node.controller.connected) {
                node.status({ fill: "green", shape: "dot", text: "connected" });
                sendConnectionStatus("ON");
                publishDiscovery();
            } else {
                node.status({ fill: "yellow", shape: "ring", text: "connecting" });
            }

            // Periodic sync timer
            if (node.sync_period > 0) {
                syncIntervalTimer = setInterval(() => {
                    performSync();
                }, node.sync_period * 1000);
            }

            // Watchdog & Heartbeat timer (every 60 seconds)
            // Keeps connection/vantage/status alive (prevents HA expire_after: 300)
            // and queries controller version to keep connection active
            watchdogTimer = setInterval(() => {
                if (node.controller && node.controller.connected) {
                    // Send periodic ON heartbeat to keep HA binary_sensor alive
                    sendConnectionStatus("ON");

                    if (node.watchdog) {
                        const elapsed = Date.now() - lastActivity;
                        if (elapsed > 120000) {
                            node.status({ fill: "red", shape: "ring", text: "watchdog: no response" });
                            sendConnectionStatus("OFF");
                        } else {
                            node.controller.sendCommand("VERSION");
                        }
                    }
                }
            }, 60000);
        } else {
            node.status({ fill: "red", shape: "dot", text: "missing controller" });
        }

        // Handle incoming messages on Input 1
        node.on("input", function (msg, send, done) {
            // Safe fallback for Node-RED < 1.0
            const _send = send || function () { node.send.apply(node, arguments); };
            const _done = done || function () { };

            if (!node.controller) {
                node.error("Vantage controller not configured", msg);
                _done();
                return;
            }

            // Input status filter and topic signature filter
            if (msg.topic && typeof msg.topic === 'string') {
                const topic = msg.topic.trim();

                // Filtro i messaggi di status per evitare loop
                if (topic.endsWith("/status")) {
                    _done();
                    return;
                }

                // Passano solo i messaggi destinati a vantage
                if (!topic.includes("/vantage/")) {
                    _done();
                    return;
                }

                // Trigger full sync manually
                if (topic.endsWith("all/vantage/sync") || topic === "vantage/sync" || msg.payload === "SYNC") {
                    performSync();
                    _done();
                    return;
                }

                // Trigger discovery manually
                if (topic.endsWith("vantage/discovery") || msg.payload === "DISCOVERY") {
                    publishDiscovery();
                    _done();
                    return;
                }

                // Compile MQTT command to Host Commands
                const cmds = proto.buildVantageCommands(msg, options);
                if (cmds.length > 0) {
                    for (const cmd of cmds) {
                        node.controller.sendCommand(cmd);
                    }
                } else {
                    log(`No command generated for input topic: ${topic} payload: ${msg.payload}`);
                }
                _done();
                return;
            }

            // If no topic (msg.topic is empty or missing), pass direct host command
            if (msg.payload) {
                let payloadStr = msg.payload;
                if (Buffer.isBuffer(payloadStr)) {
                    payloadStr = payloadStr.toString("utf8");
                } else if (typeof payloadStr !== "string") {
                    payloadStr = String(payloadStr);
                }
                payloadStr = payloadStr.trim();

                if (payloadStr === "SYNC") {
                    performSync();
                } else if (payloadStr === "DISCOVERY") {
                    publishDiscovery();
                } else if (payloadStr.length > 0) {
                    node.controller.sendCommand(payloadStr);
                }
            }

            _done();
        });

        // Clean up on node close
        node.on("close", function (removed, done) {
            if (typeof removed === "function") {
                done = removed;
                removed = false;
            }
            if (syncIntervalTimer) {
                clearInterval(syncIntervalTimer);
                syncIntervalTimer = null;
            }
            if (watchdogTimer) {
                clearInterval(watchdogTimer);
                watchdogTimer = null;
            }

            if (node.controller && node.controller.eventEmitter) {
                if (onDataHandler) node.controller.eventEmitter.removeListener("data", onDataHandler);
                if (onConnectedHandler) node.controller.eventEmitter.removeListener("connected", onConnectedHandler);
                if (onDisconnectedHandler) node.controller.eventEmitter.removeListener("disconnected", onDisconnectedHandler);
                if (onStatusHandler) node.controller.eventEmitter.removeListener("status", onStatusHandler);
            }

            if (typeof done === "function") done();
        });
    }

    RED.nodes.registerType("vantage-infusion-mqtt", VantageInfusionMqttNode);
};
