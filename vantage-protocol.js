/**
 * Vantage InFusion Host Commands Protocol Engine for Node-RED
 * Author: Bruno Leonardi
 * License: MIT
 */

const MANUFACTURER = "Vantage Controls";
const POWERED_BY = "Bruno Leonardi";

const TOPIC_LOAD_STATUS = "/load/vantage/status";
const TOPIC_BLIND_STATUS = "/blind/vantage/status";
const TOPIC_BUTTON_STATUS = "/button/vantage/status";
const TOPIC_VARIABLE_STATUS = "/variable/vantage/status";
const TOPIC_SENSOR_STATUS = "/sensor/vantage/status";
const TOPIC_TASK_STATUS = "/task/vantage/status";
const TOPIC_LED_STATUS = "/led/vantage/status";
const TOPIC_THERMOSTAT_STATUS = "/thermostat/vantage/status";
const TOPIC_VERSION_STATUS = "version/vantage/status";
const TOPIC_CONNECTION_STATUS = "connection/vantage/status";

/**
 * Strips Telnet IAC (0xFF) negotiation codes from raw incoming string/buffer
 */
function stripTelnetIAC(data) {
    if (typeof data !== "string") {
        data = data.toString("utf8");
    }
    // Strip RFC 854 Telnet commands (\xFF followed by 1 or 2 bytes)
    return data.replace(/\xFF[\xFB-\xFE][\s\S]|\xFF[\xF0-\xFA]/g, "");
}

/**
 * Extracts individual lines / frames terminated by CRLF or LF
 */
function extractLines(buffer) {
    const lines = [];
    let remainder = "";
    const cleanStr = stripTelnetIAC(buffer);
    const parts = cleanStr.split(/\r\n|\r|\n/);

    for (let i = 0; i < parts.length - 1; i++) {
        const line = parts[i].trim();
        if (line.length > 0) {
            lines.push(line);
        }
    }
    remainder = parts[parts.length - 1];
    return { lines, remainder };
}

/**
 * Parse a raw response or event line received from Vantage InFusion controller
 * Examples:
 *   "R:LOAD 120 100"
 *   "R:LOAD 120 75 3.0"
 *   "R:GETLOAD 120 100"
 *   "R:BTN 45 PRESS"
 *   "R:BLIND 55 100"
 *   "R:VARIABLE 501 22.5"
 *   "R:VARIABLE 502 \"Hello World\""
 *   "R:SENSOR 141 350"
 *   "R:TASK 301 1"
 *   "R:VERSION 3.2.0"
 */
function parseVantageEvent(line, controllerVersion = "unknown") {
    if (!line || typeof line !== "string") return null;

    const rawLine = line.trim();
    let cleaned = rawLine;

    // Strip leading prefix like "R:", "S:", "X:"
    if (/^[RSX]:/i.test(cleaned)) {
        cleaned = cleaned.substring(2).trim();
    }

    const tokens = cleaned.split(/\s+/);
    if (tokens.length === 0 || !tokens[0]) return null;

    let cmd = tokens[0].toUpperCase();
    if (cmd.startsWith("GET")) {
        cmd = cmd.substring(3);
    }

    const vid = parseInt(tokens[1], 10);

    // 1. LIGHTING LOAD
    if (cmd === "LOAD") {
        if (isNaN(vid)) return null;
        const level = parseFloat(tokens[2]) || 0;
        const state = level > 0 ? "ON" : "OFF";
        const brightness = Math.min(255, Math.max(0, Math.round(level * 2.55)));
        const fade = tokens[3] !== undefined ? parseFloat(tokens[3]) : 0;

        return {
            type: "load",
            vid: vid,
            topic: `${vid}${TOPIC_LOAD_STATUS}`,
            mqttMessage: {
                topic: `${vid}${TOPIC_LOAD_STATUS}`,
                payload: JSON.stringify({
                    state: state,
                    brightness: brightness,
                    level: level,
                    fade: fade,
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        vid: vid,
                        state: state,
                        brightness: brightness,
                        level: level,
                        fade: fade,
                        function: "Load Function",
                        data: `${state} | ${brightness} | ${fade}`,
                        response: rawLine,
                        controller_version: controllerVersion
                    }
                }),
                qos: 0,
                retain: false
            },
            statusText: `Load ${vid} -> ${state} (${level}%)`
        };
    }

    // 2. BLIND / SHUTTER / COVER
    if (cmd === "BLIND") {
        if (isNaN(vid)) return null;
        const rawArg = tokens[2] || "";
        let pos = 0;
        let state = "open";

        if (rawArg.toUpperCase() === "OPEN") {
            pos = 100;
            state = "open";
        } else if (rawArg.toUpperCase() === "CLOSE" || rawArg.toUpperCase() === "CLOSED") {
            pos = 0;
            state = "closed";
        } else if (rawArg.toUpperCase() === "STOP") {
            state = "stopped";
        } else {
            pos = parseFloat(rawArg) || 0;
            state = pos === 0 ? "closed" : "open";
        }

        return {
            type: "blind",
            vid: vid,
            topic: `${vid}${TOPIC_BLIND_STATUS}`,
            mqttMessage: {
                topic: `${vid}${TOPIC_BLIND_STATUS}`,
                payload: JSON.stringify({
                    state: state,
                    position: Math.round(pos),
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        vid: vid,
                        state: state,
                        position: Math.round(pos),
                        function: "Blind Function",
                        data: `${state} | ${pos}`,
                        response: rawLine,
                        controller_version: controllerVersion
                    }
                }),
                qos: 0,
                retain: false
            },
            statusText: `Blind ${vid} -> ${state} (${pos}%)`
        };
    }

    // 3. KEYPAD BUTTON
    if (cmd === "BTN") {
        if (isNaN(vid)) return null;
        const trigger = (tokens[2] || "PRESS").toUpperCase();
        const state = trigger === "RELEASE" ? "OFF" : "ON";

        return {
            type: "button",
            vid: vid,
            topic: `${vid}${TOPIC_BUTTON_STATUS}`,
            mqttMessage: {
                topic: `${vid}${TOPIC_BUTTON_STATUS}`,
                payload: JSON.stringify({
                    state: state,
                    trigger: trigger,
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        vid: vid,
                        state: state,
                        trigger: trigger,
                        function: "Button Function",
                        data: state,
                        response: rawLine,
                        controller_version: controllerVersion
                    }
                }),
                qos: 0,
                retain: true
            },
            statusText: `Button ${vid} -> ${state} (${trigger})`
        };
    }

    // 4. VARIABLE
    if (cmd === "VARIABLE") {
        if (isNaN(vid)) return null;
        let rest = cleaned.substring(tokens[0].length).trim();
        rest = rest.substring(String(vid).length).trim();

        let val = rest;
        if (val.startsWith('"') && val.endsWith('"')) {
            val = val.substring(1, val.length - 1);
        }

        let binary = "OFF";
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
            binary = numVal > 0 ? "ON" : "OFF";
        } else if (typeof val === "string") {
            binary = (val.toLowerCase() === "true" || val.toLowerCase() === "on") ? "ON" : "OFF";
        }

        return {
            type: "variable",
            vid: vid,
            topic: `${vid}${TOPIC_VARIABLE_STATUS}`,
            mqttMessage: {
                topic: `${vid}${TOPIC_VARIABLE_STATUS}`,
                payload: JSON.stringify({
                    state: val,
                    binary: binary,
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        vid: vid,
                        function: "Variable Function",
                        data: `${val} | ${binary}`,
                        response: rawLine,
                        controller_version: controllerVersion
                    }
                }),
                qos: 0,
                retain: false
            },
            statusText: `Variable ${vid} -> ${val}`
        };
    }

    // 5. SENSOR
    if (cmd === "SENSOR") {
        if (isNaN(vid)) return null;
        const val = parseFloat(tokens[2]) || tokens[2] || 0;

        return {
            type: "sensor",
            vid: vid,
            topic: `${vid}${TOPIC_SENSOR_STATUS}`,
            mqttMessage: {
                topic: `${vid}${TOPIC_SENSOR_STATUS}`,
                payload: JSON.stringify({
                    state: val,
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        vid: vid,
                        function: "Sensor Function",
                        data: val,
                        response: rawLine,
                        controller_version: controllerVersion
                    }
                }),
                qos: 0,
                retain: true
            },
            statusText: `Sensor ${vid} -> ${val}`
        };
    }

    // 6. TASK
    if (cmd === "TASK") {
        if (isNaN(vid)) return null;
        const rawState = tokens[2] || "1";
        const state = (parseInt(rawState, 10) === 0 || rawState.toUpperCase() === "OFF") ? "OFF" : "ON";

        return {
            type: "task",
            vid: vid,
            topic: `${vid}${TOPIC_TASK_STATUS}`,
            mqttMessage: {
                topic: `${vid}${TOPIC_TASK_STATUS}`,
                payload: JSON.stringify({
                    state: state,
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        vid: vid,
                        function: "Task Function",
                        data: state,
                        response: rawLine,
                        controller_version: controllerVersion
                    }
                }),
                qos: 0,
                retain: false
            },
            statusText: `Task ${vid} -> ${state}`
        };
    }

    // 7. LED
    if (cmd === "LED") {
        if (isNaN(vid)) return null;
        const state = tokens[2] === "1" ? "ON" : "OFF";

        return {
            type: "led",
            vid: vid,
            topic: `${vid}${TOPIC_LED_STATUS}`,
            mqttMessage: {
                topic: `${vid}${TOPIC_LED_STATUS}`,
                payload: JSON.stringify({
                    state: state,
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        vid: vid,
                        function: "LED Function",
                        response: rawLine,
                        controller_version: controllerVersion
                    }
                }),
                qos: 0,
                retain: false
            },
            statusText: `LED ${vid} -> ${state}`
        };
    }

    // 8. THERMOSTAT
    if (cmd === "THERM") {
        if (isNaN(vid)) return null;
        const heatSp = parseFloat(tokens[2]) || 20.0;
        const coolSp = parseFloat(tokens[3]) || 24.0;
        const indoorTemp = parseFloat(tokens[4]) || heatSp;
        const mode = (tokens[5] || "AUTO").toUpperCase();
        const fan = (tokens[6] || "AUTO").toUpperCase();

        return {
            type: "thermostat",
            vid: vid,
            topic: `${vid}${TOPIC_THERMOSTAT_STATUS}`,
            mqttMessage: {
                topic: `${vid}${TOPIC_THERMOSTAT_STATUS}`,
                payload: JSON.stringify({
                    heat_sp: heatSp,
                    cool_sp: coolSp,
                    indoor_temp: indoorTemp,
                    mode: mode,
                    fan: fan,
                    state: "ON",
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        vid: vid,
                        function: "Thermostat Function",
                        heat_sp: heatSp,
                        cool_sp: coolSp,
                        indoor_temp: indoorTemp,
                        mode: mode,
                        fan: fan,
                        response: rawLine,
                        controller_version: controllerVersion
                    }
                }),
                qos: 0,
                retain: true
            },
            statusText: `Thermostat ${vid} -> ${indoorTemp}°C (Heat: ${heatSp}, Cool: ${coolSp})`
        };
    }

    // 9. VERSION
    if (cmd === "VERSION") {
        const ver = tokens.slice(1).join(" ") || "unknown";

        return {
            type: "version",
            version: ver,
            topic: TOPIC_VERSION_STATUS,
            mqttMessage: {
                topic: TOPIC_VERSION_STATUS,
                payload: JSON.stringify({
                    state: ver,
                    attributes: {
                        manufacturer: MANUFACTURER,
                        powered_by: POWERED_BY,
                        function: "Controller Version",
                        controller_version: ver,
                        response: rawLine
                    }
                }),
                qos: 0,
                retain: true
            },
            statusText: `Controller Version: ${ver}`
        };
    }

    return null;
}

/**
 * Compile incoming MQTT command message into Vantage Host Command string(s)
 * Handles:
 * - <VID>/load/vantage/set
 * - <VID>/blind/vantage/set
 * - <VID>/button/vantage/set
 * - <VID>/task/vantage/set
 * - <VID>/variable/vantage/set
 * - <VID>/load/vantage/sync
 * - <VID>/blind/vantage/sync
 * - <VID>/sensor/vantage/sync
 * - <VID>/variable/vantage/sync
 * - all/vantage/sync or vantage/sync
 * - Direct raw commands: "LOAD 120 100", "BTN 45", etc.
 */
function buildVantageCommands(msg, options = {}) {
    if (!msg) return [];

    let payload = msg.payload;
    const topic = (msg.topic || "").trim();

    // If payload is object/buffer, handle accordingly
    let payloadObj = null;
    if (typeof payload === "object" && payload !== null && !Buffer.isBuffer(payload)) {
        payloadObj = payload;
        payload = payload.state !== undefined ? payload.state : JSON.stringify(payload);
    } else if (Buffer.isBuffer(payload)) {
        payload = payload.toString("utf8");
    } else if (payload !== null && payload !== undefined) {
        payload = String(payload).trim();
    } else {
        payload = "";
    }

    // Try parsing payload JSON if it looks like JSON
    if (!payloadObj && typeof payload === "string" && (payload.startsWith("{") && payload.endsWith("}"))) {
        try {
            payloadObj = JSON.parse(payload);
            if (payloadObj.state !== undefined) {
                payload = payloadObj.state;
            }
        } catch (e) {
            // ignore
        }
    }

    // Direct Vantage Host Commands (no topic or topic doesn't match vantage topic structure)
    if (!topic || (!topic.includes("/vantage/") && !topic.endsWith("vantage/sync"))) {
        if (payload && /^(LOAD|RAMPLOAD|GETLOAD|BTN|BTNPRESS|BTNRELEASE|BLIND|GETBLIND|TASK|GETTASK|VARIABLE|GETVARIABLE|SENSOR|GETSENSOR|LED|GETLED|THERM|GETTHERM|STATUS|VERSION|HELP|ECHO|INVOKE)/i.test(payload)) {
            return [payload];
        }
        return [];
    }

    // Full system synchronization
    if (topic.endsWith("all/vantage/sync") || topic === "vantage/sync") {
        return buildSyncRequests(options);
    }

    const parts = topic.split("/");
    const vid = parseInt(parts[0], 10);

    // Single item sync
    if (topic.endsWith("/load/vantage/sync") && !isNaN(vid)) {
        return [`GETLOAD ${vid}`];
    }
    if (topic.endsWith("/blind/vantage/sync") && !isNaN(vid)) {
        return [`GETBLIND ${vid}`];
    }
    if (topic.endsWith("/sensor/vantage/sync") && !isNaN(vid)) {
        return [`GETSENSOR ${vid}`];
    }
    if (topic.endsWith("/variable/vantage/sync") && !isNaN(vid)) {
        return [`GETVARIABLE ${vid}`];
    }
    if (topic.endsWith("/thermostat/vantage/sync") && !isNaN(vid)) {
        return [`GETTHERM ${vid}`];
    }
    if (topic.endsWith("/led/vantage/sync") && !isNaN(vid)) {
        return [`GETLED ${vid}`];
    }
    if (topic.endsWith("/task/vantage/sync") && !isNaN(vid)) {
        return [`GETTASK ${vid}`];
    }

    // 1. LIGHTING LOAD SET
    if (topic.endsWith("/load/vantage/set") && !isNaN(vid)) {
        if (payloadObj && payloadObj.ramp !== undefined && payloadObj.brightness !== undefined) {
            const lvl = Math.min(100, Math.max(0, Math.round(parseFloat(payloadObj.brightness) / 2.55)));
            const sec = parseFloat(payloadObj.ramp) || 1.0;
            return [`RAMPLOAD ${vid} ${lvl} ${sec}`];
        }

        const pUpper = String(payload).toUpperCase();
        if (pUpper === "ON") {
            return [`LOAD ${vid} 100`];
        }
        if (pUpper === "OFF") {
            return [`LOAD ${vid} 0`];
        }

        const numVal = parseFloat(payload);
        if (!isNaN(numVal)) {
            if (numVal <= 100 && payload.includes("%")) {
                return [`LOAD ${vid} ${Math.round(numVal)}`];
            }
            // Standard MQTT brightness 0..255
            const pct = Math.min(100, Math.max(0, Math.round(numVal / 2.55)));
            return [`LOAD ${vid} ${pct}`];
        }
        return [];
    }

    // 2. BLIND SET
    if (topic.endsWith("/blind/vantage/set") && !isNaN(vid)) {
        const pUpper = String(payload).toUpperCase();
        if (pUpper === "OPEN") {
            return [`BLIND ${vid} OPEN`];
        }
        if (pUpper === "CLOSE") {
            return [`BLIND ${vid} CLOSE`];
        }
        if (pUpper === "STOP") {
            return [`BLIND ${vid} STOP`];
        }

        let posVal = NaN;
        if (payloadObj && payloadObj.position !== undefined) {
            posVal = parseFloat(payloadObj.position);
        } else {
            posVal = parseFloat(payload);
        }

        if (!isNaN(posVal)) {
            const posClamped = Math.min(100, Math.max(0, Math.round(posVal)));
            return [`BLIND ${vid} POS ${posClamped}`];
        }
        return [];
    }

    // 3. BUTTON SET
    if (topic.endsWith("/button/vantage/set") && !isNaN(vid)) {
        const pUpper = String(payload).toUpperCase();
        if (pUpper === "PRESS") {
            return [`BTNPRESS ${vid}`];
        }
        if (pUpper === "RELEASE") {
            return [`BTNRELEASE ${vid}`];
        }
        return [`BTN ${vid}`];
    }

    // 4. TASK SET
    if (topic.endsWith("/task/vantage/set") && !isNaN(vid)) {
        const pUpper = String(payload).toUpperCase();
        let trigger = "BOOT";
        if (pUpper !== "ON" && pUpper !== "OFF" && pUpper !== "1" && pUpper !== "0" && pUpper !== "") {
            trigger = pUpper;
        }
        return [`TASK ${vid} ${trigger}`];
    }

    // 5. VARIABLE SET
    if (topic.endsWith("/variable/vantage/set") && !isNaN(vid)) {
        return [`VARIABLE ${vid} ${payload}`];
    }

    // 6. LED SET
    if (topic.endsWith("/led/vantage/set") && !isNaN(vid)) {
        const pUpper = String(payload).toUpperCase();
        const stateNum = (pUpper === "ON" || pUpper === "1" || pUpper === "TRUE") ? 1 : 0;
        return [`LED ${vid} ${stateNum}`];
    }

    // 7. THERMOSTAT SET
    if (topic.endsWith("/thermostat/heat/vantage/set") && !isNaN(vid)) {
        const val = parseFloat(payload);
        if (!isNaN(val)) return [`THERM ${vid} ${val}`];
    }
    if (topic.endsWith("/thermostat/cool/vantage/set") && !isNaN(vid)) {
        const val = parseFloat(payload);
        if (!isNaN(val)) return [`THERM ${vid} 0 ${val}`];
    }
    if (topic.endsWith("/thermostat/vantage/set") && !isNaN(vid)) {
        if (payloadObj && payloadObj.heat_sp !== undefined) {
            const h = parseFloat(payloadObj.heat_sp) || 20;
            const c = parseFloat(payloadObj.cool_sp) || 24;
            return [`THERM ${vid} ${h} ${c}`];
        }
        const val = parseFloat(payload);
        if (!isNaN(val)) return [`THERM ${vid} ${val} ${val + 2}`];
    }

    return [];
}

/**
 * Build initial subscription commands to send to Vantage InFusion upon socket connection
 */
function buildStartupSubscriptions() {
    return [
        "STATUS NONE",
        "STATUS LOAD",
        "STATUS BTN",
        "STATUS TEXT",
        "STATUS VARIABLE",
        "STATUS BLIND",
        "STATUS TASK",
        "STATUS LED",
        "STATUS THERM",
        "ECHO OFF",
        "VERSION"
    ];
}

/**
 * Parse a comma-separated list of IDs into an array of integers
 */
function parseIdList(listStr) {
    if (!listStr) return [];
    return String(listStr)
        .split(",")
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n > 0);
}

/**
 * Generate synchronization requests for all configured entities
 */
function buildSyncRequests(options = {}) {
    const commands = [];

    const loads = parseIdList(options.load);
    if (options.load_sync !== false && loads.length > 0) {
        for (const vid of loads) {
            commands.push(`GETLOAD ${vid}`);
        }
    }

    const blinds = parseIdList(options.blind);
    if (options.blind_sync !== false && blinds.length > 0) {
        for (const vid of blinds) {
            commands.push(`GETBLIND ${vid}`);
        }
    }

    const sensors = parseIdList(options.sensor);
    if (options.sensor_sync !== false && sensors.length > 0) {
        for (const vid of sensors) {
            commands.push(`GETSENSOR ${vid}`);
        }
    }

    const variables = parseIdList(options.variable);
    if (options.variable_sync !== false && variables.length > 0) {
        for (const vid of variables) {
            commands.push(`GETVARIABLE ${vid}`);
        }
    }

    const therms = parseIdList(options.thermostat);
    if (options.thermostat_sync !== false && therms.length > 0) {
        for (const vid of therms) {
            commands.push(`GETTHERM ${vid}`);
        }
    }

    const leds = parseIdList(options.led);
    if (options.led_sync !== false && leds.length > 0) {
        for (const vid of leds) {
            commands.push(`GETLED ${vid}`);
        }
    }

    const tasks = parseIdList(options.task);
    if (options.task_sync !== false && tasks.length > 0) {
        for (const vid of tasks) {
            commands.push(`GETTASK ${vid}`);
        }
    }

    return commands;
}

/**
 * Build Home Assistant Auto-Discovery MQTT configuration messages
 */
function buildDiscoveryMessages(options = {}) {
    const prefix = (options.discoveryPrefix || "homeassistant").replace(/\/$/, "");
    const messages = [];

    // Controller connectivity sensor
    messages.push({
        topic: `${prefix}/binary_sensor/vantage_connection/config`,
        payload: JSON.stringify({
            name: "Vantage InFusion Controller",
            unique_id: "vantage_infusion_connection",
            device_class: "connectivity",
            state_topic: TOPIC_CONNECTION_STATUS,
            value_template: "{{ value_json.state }}",
            payload_on: "ON",
            payload_off: "OFF",
            device: {
                identifiers: ["vantage_infusion_controller"],
                name: "Vantage InFusion",
                manufacturer: MANUFACTURER,
                model: "InFusion Controller"
            }
        }),
        qos: 0,
        retain: true
    });

    // Loads (Lights)
    const loads = parseIdList(options.load);
    for (const vid of loads) {
        messages.push({
            topic: `${prefix}/light/vantage_load_${vid}/config`,
            payload: JSON.stringify({
                name: `Vantage Light ${vid}`,
                unique_id: `vantage_load_${vid}`,
                schema: "json",
                command_topic: `${vid}/load/vantage/set`,
                state_topic: `${vid}/load/vantage/status`,
                brightness: true,
                brightness_scale: 255,
                device: {
                    identifiers: [`vantage_load_${vid}`],
                    name: `Vantage Load ${vid}`,
                    manufacturer: MANUFACTURER,
                    via_device: "vantage_infusion_controller"
                }
            }),
            qos: 0,
            retain: true
        });
    }

    // Blinds (Covers)
    const blinds = parseIdList(options.blind);
    for (const vid of blinds) {
        messages.push({
            topic: `${prefix}/cover/vantage_blind_${vid}/config`,
            payload: JSON.stringify({
                name: `Vantage Blind ${vid}`,
                unique_id: `vantage_blind_${vid}`,
                command_topic: `${vid}/blind/vantage/set`,
                state_topic: `${vid}/blind/vantage/status`,
                position_topic: `${vid}/blind/vantage/status`,
                value_template: "{{ value_json.state }}",
                position_template: "{{ value_json.position }}",
                set_position_topic: `${vid}/blind/vantage/set`,
                payload_open: "OPEN",
                payload_close: "CLOSE",
                payload_stop: "STOP",
                position_open: 100,
                position_closed: 0,
                device: {
                    identifiers: [`vantage_blind_${vid}`],
                    name: `Vantage Blind ${vid}`,
                    manufacturer: MANUFACTURER,
                    via_device: "vantage_infusion_controller"
                }
            }),
            qos: 0,
            retain: true
        });
    }

    // Sensors
    const sensors = parseIdList(options.sensor);
    for (const vid of sensors) {
        messages.push({
            topic: `${prefix}/sensor/vantage_sensor_${vid}/config`,
            payload: JSON.stringify({
                name: `Vantage Sensor ${vid}`,
                unique_id: `vantage_sensor_${vid}`,
                state_topic: `${vid}/sensor/vantage/status`,
                value_template: "{{ value_json.state }}",
                device: {
                    identifiers: [`vantage_sensor_${vid}`],
                    name: `Vantage Sensor ${vid}`,
                    manufacturer: MANUFACTURER,
                    via_device: "vantage_infusion_controller"
                }
            }),
            qos: 0,
            retain: true
        });
    }

    // Variables (as switches)
    const variables = parseIdList(options.variable);
    for (const vid of variables) {
        messages.push({
            topic: `${prefix}/switch/vantage_variable_${vid}/config`,
            payload: JSON.stringify({
                name: `Vantage Variable ${vid}`,
                unique_id: `vantage_variable_${vid}`,
                command_topic: `${vid}/variable/vantage/set`,
                state_topic: `${vid}/variable/vantage/status`,
                value_template: "{{ value_json.binary }}",
                payload_on: "1",
                payload_off: "0",
                state_on: "ON",
                state_off: "OFF",
                device: {
                    identifiers: [`vantage_variable_${vid}`],
                    name: `Vantage Variable ${vid}`,
                    manufacturer: MANUFACTURER,
                    via_device: "vantage_infusion_controller"
                }
            }),
            qos: 0,
            retain: true
        });
    }

    // Tasks (Buttons in Home Assistant)
    const tasks = parseIdList(options.task);
    for (const vid of tasks) {
        messages.push({
            topic: `${prefix}/button/vantage_task_${vid}/config`,
            payload: JSON.stringify({
                name: `Vantage Task ${vid}`,
                unique_id: `vantage_task_${vid}`,
                command_topic: `${vid}/task/vantage/set`,
                payload_press: "BOOT",
                icon: "mdi:play-circle-outline",
                device: {
                    identifiers: [`vantage_task_${vid}`],
                    name: `Vantage Task ${vid}`,
                    manufacturer: MANUFACTURER,
                    via_device: "vantage_infusion_controller"
                }
            }),
            qos: 0,
            retain: true
        });
    }

    // Keypad Buttons
    const buttons = parseIdList(options.buttons_string);
    for (const vid of buttons) {
        messages.push({
            topic: `${prefix}/button/vantage_button_${vid}/config`,
            payload: JSON.stringify({
                name: `Vantage Button ${vid}`,
                unique_id: `vantage_button_${vid}`,
                command_topic: `${vid}/button/vantage/set`,
                payload_press: "PRESS",
                icon: "mdi:radiobox-marked",
                device: {
                    identifiers: [`vantage_button_${vid}`],
                    name: `Vantage Button ${vid}`,
                    manufacturer: MANUFACTURER,
                    via_device: "vantage_infusion_controller"
                }
            }),
            qos: 0,
            retain: true
        });
    }

    // Keypad LEDs
    const leds = parseIdList(options.led);
    for (const vid of leds) {
        messages.push({
            topic: `${prefix}/light/vantage_led_${vid}/config`,
            payload: JSON.stringify({
                name: `Vantage LED ${vid}`,
                unique_id: `vantage_led_${vid}`,
                command_topic: `${vid}/led/vantage/set`,
                state_topic: `${vid}/led/vantage/status`,
                value_template: "{{ value_json.state }}",
                payload_on: "ON",
                payload_off: "OFF",
                icon: "mdi:led-on",
                device: {
                    identifiers: [`vantage_led_${vid}`],
                    name: `Vantage LED ${vid}`,
                    manufacturer: MANUFACTURER,
                    via_device: "vantage_infusion_controller"
                }
            }),
            qos: 0,
            retain: true
        });
    }

    // Thermostats (Climate)
    const therms = parseIdList(options.thermostat);
    for (const vid of therms) {
        messages.push({
            topic: `${prefix}/climate/vantage_therm_${vid}/config`,
            payload: JSON.stringify({
                name: `Vantage Thermostat ${vid}`,
                unique_id: `vantage_therm_${vid}`,
                temperature_command_topic: `${vid}/thermostat/vantage/set`,
                temperature_state_topic: `${vid}/thermostat/vantage/status`,
                temperature_state_template: "{{ value_json.heat_sp }}",
                current_temperature_topic: `${vid}/thermostat/vantage/status`,
                current_temperature_template: "{{ value_json.indoor_temp }}",
                min_temp: 10,
                max_temp: 35,
                temp_step: 0.5,
                temperature_unit: "C",
                device: {
                    identifiers: [`vantage_therm_${vid}`],
                    name: `Vantage Thermostat ${vid}`,
                    manufacturer: MANUFACTURER,
                    via_device: "vantage_infusion_controller"
                }
            }),
            qos: 0,
            retain: true
        });
    }

    return messages;
}

module.exports = {
    MANUFACTURER,
    POWERED_BY,
    TOPIC_LOAD_STATUS,
    TOPIC_BLIND_STATUS,
    TOPIC_BUTTON_STATUS,
    TOPIC_VARIABLE_STATUS,
    TOPIC_SENSOR_STATUS,
    TOPIC_TASK_STATUS,
    TOPIC_LED_STATUS,
    TOPIC_THERMOSTAT_STATUS,
    TOPIC_VERSION_STATUS,
    TOPIC_CONNECTION_STATUS,
    stripTelnetIAC,
    extractLines,
    parseVantageEvent,
    buildVantageCommands,
    buildStartupSubscriptions,
    buildSyncRequests,
    buildDiscoveryMessages,
    parseIdList
};
