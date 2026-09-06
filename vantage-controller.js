/**
 * Vantage InFusion Controller Configuration Node
 * Author: Bruno Leonardi
 * License: MIT
 */

const net = require("net");
const EventEmitter = require("events");
const proto = require("./vantage-protocol.js");

module.exports = function (RED) {
    function VantageControllerNode(n) {
        RED.nodes.createNode(this, n);
        const node = this;

        node.host = n.host || "127.0.0.1";
        node.port = parseInt(n.port, 10) || 3001;
        node.keepalive = parseInt(n.keepalive, 10) || 60;
        node.pacing = parseInt(n.pacing, 10) || 50;
        node.reconnectDelay = 2000;
        node.debug = n.debug || false;

        node.socket = null;
        node.connected = false;
        node.controllerVersion = "unknown";
        node.eventEmitter = new EventEmitter();
        node.eventEmitter.setMaxListeners(100);

        let rxBuffer = "";
        let commandQueue = [];
        let isSending = false;
        let reconnectTimer = null;
        let keepaliveTimer = null;
        let currentBackoff = node.reconnectDelay;
        let isClosed = false;

        function log(msg) {
            if (node.debug) node.log(msg);
        }

        function warn(msg) {
            node.warn(msg);
        }

        function error(msg) {
            node.error(msg);
        }

        /**
         * Broadcast connection state to all registered bridge nodes
         */
        function broadcastStatus(fill, shape, text) {
            node.eventEmitter.emit("status", { fill, shape, text });
        }

        /**
         * Connect to the Vantage InFusion controller via TCP
         */
        function connect() {
            if (isClosed) return;
            if (node.socket) {
                try {
                    node.socket.removeAllListeners();
                    node.socket.destroy();
                } catch (e) {
                    // ignore
                }
                node.socket = null;
            }

            broadcastStatus("yellow", "ring", "connecting");
            log(`Connecting to Vantage controller at ${node.host}:${node.port}...`);

            node.socket = new net.Socket();
            node.socket.setKeepAlive(true, 10000);
            node.socket.setTimeout(60000);

            node.socket.on("connect", () => {
                node.connected = true;
                currentBackoff = node.reconnectDelay;
                broadcastStatus("green", "dot", "connected");
                node.log(`Connected to Vantage InFusion at ${node.host}:${node.port}`);

                // Send startup subscription commands
                const subs = proto.buildStartupSubscriptions();
                for (const cmd of subs) {
                    node.sendCommand(cmd);
                }

                startKeepalive();
                node.eventEmitter.emit("connected");
            });

            node.socket.on("data", (chunk) => {
                rxBuffer += chunk.toString("utf8");
                const extracted = proto.extractLines(rxBuffer);
                rxBuffer = extracted.remainder;

                for (const line of extracted.lines) {
                    log(`<< ${line}`);

                    // Check for version response
                    if (/^[RSX]?:?VERSION/i.test(line)) {
                        const parsed = proto.parseVantageEvent(line);
                        if (parsed && parsed.version) {
                            node.controllerVersion = parsed.version;
                        }
                    }

                    node.eventEmitter.emit("data", line);
                }
            });

            node.socket.on("error", (err) => {
                log(`Socket error: ${err.message}`);
                broadcastStatus("red", "ring", `error: ${err.message}`);
            });

            node.socket.on("timeout", () => {
                log("Socket inactive timeout, sending VERSION ping");
                node.sendCommand("VERSION");
            });

            node.socket.on("close", (hadError) => {
                node.connected = false;
                stopKeepalive();
                broadcastStatus("red", "ring", "disconnected");
                node.eventEmitter.emit("disconnected");

                if (!isClosed) {
                    scheduleReconnect();
                }
            });

            node.socket.connect(node.port, node.host);
        }

        /**
         * Schedule reconnection with exponential backoff
         */
        function scheduleReconnect() {
            if (reconnectTimer || isClosed) return;
            log(`Reconnecting in ${currentBackoff}ms...`);
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                currentBackoff = Math.min(30000, currentBackoff * 1.5);
                connect();
            }, currentBackoff);
        }

        /**
         * Keepalive / Watchdog heartbeat
         */
        function startKeepalive() {
            stopKeepalive();
            if (node.keepalive > 0) {
                keepaliveTimer = setInterval(() => {
                    if (node.connected) {
                        node.sendCommand("VERSION");
                    }
                }, node.keepalive * 1000);
            }
        }

        function stopKeepalive() {
            if (keepaliveTimer) {
                clearInterval(keepaliveTimer);
                keepaliveTimer = null;
            }
        }

        /**
         * Enqueue and send a command to the controller with pacing
         */
        node.sendCommand = function (cmd) {
            if (!cmd || typeof cmd !== "string") return;
            const trimmed = cmd.trim();
            if (trimmed.length === 0) return;

            commandQueue.push(trimmed);
            processQueue();
        };

        function processQueue() {
            if (isSending || commandQueue.length === 0 || !node.connected || !node.socket) {
                return;
            }

            isSending = true;
            const nextCmd = commandQueue.shift();
            log(`>> ${nextCmd}`);

            node.socket.write(nextCmd + "\r\n", "utf8", (err) => {
                if (err) {
                    warn(`Failed to write command "${nextCmd}": ${err.message}`);
                }
                setTimeout(() => {
                    isSending = false;
                    processQueue();
                }, node.pacing);
            });
        }

        // Connect on startup
        connect();

        node.on("close", (removed, done) => {
            if (typeof removed === "function") {
                done = removed;
                removed = false;
            }
            isClosed = true;
            stopKeepalive();
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            commandQueue = [];
            if (node.socket) {
                try {
                    node.socket.removeAllListeners();
                    node.socket.destroy();
                } catch (e) {
                    // ignore
                }
                node.socket = null;
            }
            broadcastStatus("grey", "ring", "closed");
            if (typeof done === "function") done();
        });
    }

    RED.nodes.registerType("vantage-controller", VantageControllerNode);
};
