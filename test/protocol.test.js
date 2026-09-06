const assert = require("assert");
const proto = require("../vantage-protocol.js");

console.log("Starting unit tests for vantage-protocol.js...\n");

let passed = 0;
let failed = 0;

function it(desc, fn) {
    try {
        fn();
        console.log(`  [PASS] ${desc}`);
        passed++;
    } catch (e) {
        console.error(`  [FAIL] ${desc}: ${e.message}`);
        failed++;
    }
}

// 1. Line extraction & IAC stripping
it("stripTelnetIAC and extractLines: CRLF separated frames", () => {
    const raw = "R:LOAD 120 100\r\nR:BTN 45 PRESS\r\n";
    const res = proto.extractLines(raw);
    assert.strictEqual(res.lines.length, 2);
    assert.strictEqual(res.lines[0], "R:LOAD 120 100");
    assert.strictEqual(res.lines[1], "R:BTN 45 PRESS");
    assert.strictEqual(res.remainder, "");
});

it("extractLines: handles incomplete buffer remainder", () => {
    const raw = "R:LOAD 120 100\r\nR:BTN 45";
    const res = proto.extractLines(raw);
    assert.strictEqual(res.lines.length, 1);
    assert.strictEqual(res.lines[0], "R:LOAD 120 100");
    assert.strictEqual(res.remainder, "R:BTN 45");
});

// 2. Parse Load
it("parseVantageEvent: Light ON (R:LOAD 120 100)", () => {
    const res = proto.parseVantageEvent("R:LOAD 120 100");
    assert.ok(res);
    assert.strictEqual(res.type, "load");
    assert.strictEqual(res.vid, 120);
    assert.strictEqual(res.topic, "120/load/vantage/status");
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "ON");
    assert.strictEqual(payload.level, 100);
    assert.strictEqual(payload.brightness, 255);
});

it("parseVantageEvent: Light Dimmer 50% (R:LOAD 120 50)", () => {
    const res = proto.parseVantageEvent("R:LOAD 120 50");
    assert.ok(res);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "ON");
    assert.strictEqual(payload.level, 50);
    assert.strictEqual(payload.brightness, 127);
});

it("parseVantageEvent: Light OFF (R:LOAD 120 0)", () => {
    const res = proto.parseVantageEvent("R:LOAD 120 0");
    assert.ok(res);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "OFF");
    assert.strictEqual(payload.brightness, 0);
});

it("parseVantageEvent: Light Query (R:GETLOAD 120 75)", () => {
    const res = proto.parseVantageEvent("R:GETLOAD 120 75");
    assert.ok(res);
    assert.strictEqual(res.vid, 120);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "ON");
    assert.strictEqual(payload.level, 75);
});

// 3. Parse Blind
it("parseVantageEvent: Blind Open (R:BLIND 55 100)", () => {
    const res = proto.parseVantageEvent("R:BLIND 55 100");
    assert.ok(res);
    assert.strictEqual(res.type, "blind");
    assert.strictEqual(res.vid, 55);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "open");
    assert.strictEqual(payload.position, 100);
});

it("parseVantageEvent: Blind Closed (R:BLIND 55 0)", () => {
    const res = proto.parseVantageEvent("R:BLIND 55 0");
    assert.ok(res);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "closed");
    assert.strictEqual(payload.position, 0);
});

// 4. Parse Button
it("parseVantageEvent: Button Press (R:BTN 45 PRESS)", () => {
    const res = proto.parseVantageEvent("R:BTN 45 PRESS");
    assert.ok(res);
    assert.strictEqual(res.type, "button");
    assert.strictEqual(res.vid, 45);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "ON");
    assert.strictEqual(payload.trigger, "PRESS");
});

it("parseVantageEvent: Button Release (R:BTN 45 RELEASE)", () => {
    const res = proto.parseVantageEvent("R:BTN 45 RELEASE");
    assert.ok(res);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "OFF");
    assert.strictEqual(payload.trigger, "RELEASE");
});

// 5. Parse Variable
it("parseVantageEvent: Variable string and number (R:VARIABLE 501 22.5)", () => {
    const res = proto.parseVantageEvent("R:VARIABLE 501 22.5");
    assert.ok(res);
    assert.strictEqual(res.type, "variable");
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "22.5");
    assert.strictEqual(payload.binary, "ON");
});

it("parseVantageEvent: Variable string in quotes (R:VARIABLE 502 \"Auto\")", () => {
    const res = proto.parseVantageEvent('R:VARIABLE 502 "Auto"');
    assert.ok(res);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "Auto");
});

// 6. Parse Sensor
it("parseVantageEvent: Sensor Value (R:SENSOR 141 350)", () => {
    const res = proto.parseVantageEvent("R:SENSOR 141 350");
    assert.ok(res);
    assert.strictEqual(res.type, "sensor");
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, 350);
});

// 7. Parse Task
it("parseVantageEvent: Task Triggered (R:TASK 301 1)", () => {
    const res = proto.parseVantageEvent("R:TASK 301 1");
    assert.ok(res);
    assert.strictEqual(res.type, "task");
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "ON");
});

// 8. Parse Version
it("parseVantageEvent: Controller Version (R:VERSION 3.2.0 InFusion)", () => {
    const res = proto.parseVantageEvent("R:VERSION 3.2.0 InFusion");
    assert.ok(res);
    assert.strictEqual(res.type, "version");
    assert.strictEqual(res.version, "3.2.0 InFusion");
});

// 9. Commands Compilation
it("buildVantageCommands: Light ON", () => {
    const cmds = proto.buildVantageCommands({ topic: "120/load/vantage/set", payload: "ON" });
    assert.deepStrictEqual(cmds, ["LOAD 120 100"]);
});

it("buildVantageCommands: Light OFF", () => {
    const cmds = proto.buildVantageCommands({ topic: "120/load/vantage/set", payload: "OFF" });
    assert.deepStrictEqual(cmds, ["LOAD 120 0"]);
});

it("buildVantageCommands: Light Brightness 127", () => {
    const cmds = proto.buildVantageCommands({ topic: "120/load/vantage/set", payload: 127 });
    assert.deepStrictEqual(cmds, ["LOAD 120 50"]);
});

it("buildVantageCommands: Light Rampload JSON", () => {
    const cmds = proto.buildVantageCommands({
        topic: "120/load/vantage/set",
        payload: { state: "ON", brightness: 255, ramp: 2.5 }
    });
    assert.deepStrictEqual(cmds, ["RAMPLOAD 120 100 2.5"]);
});

it("buildVantageCommands: Blind Open/Close/Stop/Pos", () => {
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "55/blind/vantage/set", payload: "OPEN" }), ["BLIND 55 OPEN"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "55/blind/vantage/set", payload: "CLOSE" }), ["BLIND 55 CLOSE"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "55/blind/vantage/set", payload: "STOP" }), ["BLIND 55 STOP"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "55/blind/vantage/set", payload: 75 }), ["BLIND 55 POS 75"]);
});

it("buildVantageCommands: Direct Host Command", () => {
    const cmds = proto.buildVantageCommands({ payload: "LOAD 120 80" });
    assert.deepStrictEqual(cmds, ["LOAD 120 80"]);
});

// 10. Sync requests & Discovery
it("buildSyncRequests: generates requests for configured IDs including tasks", () => {
    const sync = proto.buildSyncRequests({
        load: "120,121",
        blind: "55",
        sensor: "141",
        variable: "501",
        task: "301,302",
        led: "401",
        thermostat: "201"
    });
    assert.deepStrictEqual(sync, [
        "GETLOAD 120",
        "GETLOAD 121",
        "GETBLIND 55",
        "GETSENSOR 141",
        "GETVARIABLE 501",
        "GETTHERM 201",
        "GETLED 401",
        "GETTASK 301",
        "GETTASK 302"
    ]);
});

it("parseVantageEvent: Thermostat (R:THERM 201 21.0 25.0 22.5 HEAT AUTO)", () => {
    const res = proto.parseVantageEvent("R:THERM 201 21.0 25.0 22.5 HEAT AUTO");
    assert.ok(res);
    assert.strictEqual(res.type, "thermostat");
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.heat_sp, 21.0);
    assert.strictEqual(payload.cool_sp, 25.0);
    assert.strictEqual(payload.indoor_temp, 22.5);
    assert.strictEqual(payload.mode, "HEAT");
    assert.strictEqual(payload.fan, "AUTO");
});

it("parseVantageEvent: Keypad LED (R:LED 401 1)", () => {
    const res = proto.parseVantageEvent("R:LED 401 1");
    assert.ok(res);
    assert.strictEqual(res.type, "led");
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "ON");
});

it("parseVantageEvent: GETTASK response (R:GETTASK 301 1)", () => {
    const res = proto.parseVantageEvent("R:GETTASK 301 1");
    assert.ok(res);
    assert.strictEqual(res.type, "task");
    assert.strictEqual(res.vid, 301);
    const payload = JSON.parse(res.mqttMessage.payload);
    assert.strictEqual(payload.state, "ON");
});

it("buildVantageCommands: Task, LED, and Thermostat", () => {
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "301/task/vantage/set", payload: "BOOT" }), ["TASK 301 BOOT"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "301/task/vantage/sync" }), ["GETTASK 301"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "401/led/vantage/set", payload: "ON" }), ["LED 401 1"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "401/led/vantage/set", payload: "OFF" }), ["LED 401 0"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "201/thermostat/heat/vantage/set", payload: 21.5 }), ["THERM 201 21.5"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "201/thermostat/vantage/sync" }), ["GETTHERM 201"]);
    assert.deepStrictEqual(proto.buildVantageCommands({ topic: "401/led/vantage/sync" }), ["GETLED 401"]);
});

it("buildDiscoveryMessages: generates Home Assistant config topics with tasks, leds, therms", () => {
    const msgs = proto.buildDiscoveryMessages({
        load: "120",
        blind: "55",
        sensor: "141",
        variable: "501",
        task: "301",
        buttons_string: "45",
        led: "401",
        thermostat: "201"
    });
    assert.strictEqual(msgs.length, 9); // connection + load + blind + sensor + variable + task + button + led + therm
    assert.ok(msgs.some(m => m.topic.includes("button/vantage_task_301/config")));
    assert.ok(msgs.some(m => m.topic.includes("button/vantage_button_45/config")));
    assert.ok(msgs.some(m => m.topic.includes("light/vantage_led_401/config")));
    assert.ok(msgs.some(m => m.topic.includes("climate/vantage_therm_201/config")));
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
