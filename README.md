# node-red-contrib-vantage-infusion-mqtt

[![npm version](https://img.shields.io/npm/v/node-red-contrib-vantage-infusion-mqtt.svg)](https://www.npmjs.com/package/node-red-contrib-vantage-infusion-mqtt)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Un bridge bidirezionale professionale, performante e affidabile tra il protocollo **Vantage InFusion (Legrand) Host Commands** e **MQTT** per **Node-RED**.

Progettato con **zero dipendenze esterne** (utilizza esclusivamente i moduli nativi Node.js `net` ed `events`) e dotato di un motore di connessione TCP/Telnet nativo ad altissima resilienza con **doppia uscita**:
1. **Uscita 1 (MQTT)**: pubblica topic strutturati e payload JSON formattati per broker MQTT e controller domotici (es. Home Assistant).
2. **Uscita 2 (Vantage Raw)**: emette la stringa di testo originale dell'evento ricevuto dal controller *as-is* in chiaro (es. `R:LOAD 120 100`), ideale per diagnostica, filtraggio o elaborazioni dedicate.

Include inoltre l'**Auto-Discovery MQTT per Home Assistant** opzionale, che genera e pubblica automaticamente le configurazioni persistenti (`retain: true`), rendendo luci, dimmer, tapparelle, sensori, variabili e lo stato di connessione immediatamente visibili in Home Assistant senza dover scrivere alcun codice YAML!

---

## Caratteristiche Principali

- **Connessione TCP/Telnet Nativa & Zero Dipendenze**:
  - Socket TCP bidirezionale persistente con gestione automatica del framing di riga (terminatore CRLF / `\r\n`).
  - Compatibile sia con la porta standard **3001** (Standard Host in chiaro) che con la porta **23** (Telnet con filtraggio trasparente dei comandi IAC RFC 854).
  - Riconnessione automatica a backoff esponenziale (da 500 ms a 30 s) in caso di interruzione di rete o riavvio del controller.
  - Sottoscrizione asincrona automatica all'apertura del socket (`STATUS LOAD`, `STATUS BTN`, `STATUS TEXT`, `STATUS VARIABLE`, `STATUS BLIND`, `STATUS TASK`, `STATUS LED`, `STATUS THERM`, `ECHO OFF`, `VERSION`).
  - Coda di invio comandi serializzata con **pacing delay** configurabile (default 50 ms) per evitare congestioni e non sovraccaricare il processore del controller InFusion.
  - Watchdog heartbeat integrato tramite interrogazione periodica `VERSION`.

- **Traduzione Completa degli Oggetti Vantage InFusion**:
  - **Carichi Luci & Dimmer (`LOAD`)**: Acceso (`ON`), Spento (`OFF`), regolazione luminosità proporzionale (`0-255`), supporto rampe di transizione personalizzate (`RAMPLOAD <VID> <Level> <Sec>`), interrogazione stato (`GETLOAD`).
  - **Tapparelle, Veneziane & Coperture (`BLIND`)**: Apertura (`OPEN`), Chiusura (`CLOSE`), Stop (`STOP`), posizionamento percentuale (`POS <0-100>`), interrogazione stato (`GETBLIND`).
  - **Pulsanti e Tastiere (`BTN`)**: Pressione (`PRESS`), rilascio (`RELEASE`), simulazione combinata tocco rapido (`BTN`), invio rilascio programmato all'avvio (`button_sync`).
  - **LED Tastiere (`LED`)**: Stato LED di feedback (`ON` / `OFF`), forzatura e lettura (`GETLED`).
  - **Variabili di Sistema (`VARIABLE`)**: Supporto per stringhe testuali, numeri decimali e stati logici booleani/binari (`ON` / `OFF`), lettura (`GETVARIABLE`).
  - **Sensori (`SENSOR`)**: Lettura e pubblicazione valori analogici/digitali dei sensori di luminosità, vento, temperatura, ecc. (`GETSENSOR`).
  - **Task e Scenari Globali (`TASK`)**: Esecuzione immediata dei task programmati nel Design Center (`TASK <VID> BOOT`).
  - **Diagnostica & Versione Controller (`VERSION`)**: Rilevamento automatico e pubblicazione della versione firmware attiva.

- **Doppia Uscita Indipendente**:
  - **Uscita 1 (MQTT)**: `{ topic: "120/load/vantage/status", payload: "{...}", qos: 0, retain: false }`
  - **Uscita 2 (Vantage Raw)**: `{ topic: "vantage/raw/event", payload: "R:LOAD 120 100" }`

- **Integrazione Home Assistant (MQTT Auto-Discovery)**:
  - Genera payload conformi agli standard (`homeassistant/<componente>/.../config`) per luci con dimmer, coperture motorizzate, sensori, switch per variabili e sensore binario di connettività.

---

## Architettura e Schema dei Flussi

```
                           ┌───────────────────────────────┐
                           │   Controller Vantage InFusion │
                           │     (TCP Porta 3001 / 23)     │
                           └──────────────┬────────────────┘
                                          │ Host Commands (CRLF)
                                          ▼
 [MQTT In / Comandi Set] ──► ┌───────────────────────────┐ ──► Uscita 1: [MQTT Out / Broker]
 (es. 120/load/vantage/set)  │    vantage-infusion-mqtt  │       (JSON formattato & Discovery)
                             └───────────────────────────┘ ──► Uscita 2: [Debug / Raw as-is]
                                                               (es. R:LOAD 120 100)
```

---

## Installazione

### In Node-RED Locale / Standalone

Esegui il comando nella tua cartella utente di Node-RED (solitamente `~/.node-red`):

```bash
cd ~/.node-red
npm install node-red-contrib-vantage-infusion-mqtt
```

Oppure cerca **`node-red-contrib-vantage-infusion-mqtt`** direttamente nel **Gestore della Tavolozza (Palette Manager)** di Node-RED.

---

### In Home Assistant (Add-on Node-RED)

Se utilizzi l'add-on ufficiale Node-RED su Home Assistant:

1. Apri **Home Assistant** e vai su **Impostazioni** → **Add-on** → **Node-RED**.
2. Fai clic sulla scheda **Configurazione**.
3. Nella sezione **npm packages**, aggiungi:
   ```yaml
   npm_packages:
     - node-red-contrib-vantage-infusion-mqtt
   ```
4. Fai clic su **Salva** e **Riavvia** l'add-on. Al riavvio il nodo sarà pronto nella palette!

---

## Riferimento Topic MQTT

### Topic di Stato (Emessi su Uscita 1)

| Oggetto | Topic MQTT | Esempio di Payload JSON |
|---|---|---|
| **Carico Luce / Dimmer** | `<VID>/load/vantage/status` | `{"state":"ON","brightness":255,"level":100,"fade":0,"attributes":{...}}` |
| **Tapparella / Veneziana**| `<VID>/blind/vantage/status` | `{"state":"open","position":100,"attributes":{...}}` |
| **Pulsante Tastiera** | `<VID>/button/vantage/status` | `{"state":"ON","trigger":"PRESS","attributes":{...}}` |
| **Variabile Interna** | `<VID>/variable/vantage/status` | `{"state":"22.5","binary":"ON","attributes":{...}}` |
| **Sensore** | `<VID>/sensor/vantage/status` | `{"state":350,"attributes":{...}}` |
| **Task Programmato** | `<VID>/task/vantage/status` | `{"state":"ON","attributes":{...}}` |
| **LED Feedback** | `<VID>/led/vantage/status` | `{"state":"ON","attributes":{...}}` |
| **Versione Controller** | `version/vantage/status` | `{"state":"3.2.0 InFusion","attributes":{...}}` |
| **Stato Connessione** | `connection/vantage/status` | `{"state":"ON","attributes":{"function":"Connection status"}}` |

---

### Topic di Comando (Ricevuti in Ingresso)

| Comando | Topic MQTT | Payload | Host Command Generato |
|---|---|---|---|
| **Luce On/Off** | `<VID>/load/vantage/set` | `"ON"` / `"OFF"` | `LOAD <VID> 100` / `LOAD <VID> 0` |
| **Luce Dimmer** | `<VID>/load/vantage/set` | `0`–`255` | `LOAD <VID> <0-100>` |
| **Luce Rampa (Ramp)**| `<VID>/load/vantage/set` | `{"state":"ON","brightness":200,"ramp":2.5}` | `RAMPLOAD <VID> 78 2.5` |
| **Tapparella Apri/Chiudi/Stop** | `<VID>/blind/vantage/set` | `"OPEN"`, `"CLOSE"`, `"STOP"` | `BLIND <VID> OPEN`, `BLIND <VID> CLOSE`, `BLIND <VID> STOP` |
| **Tapparella Posizione** | `<VID>/blind/vantage/set` | `0`–`100` oppure `{"position":75}` | `BLIND <VID> POS <0-100>` |
| **Pressione Pulsante** | `<VID>/button/vantage/set` | `"PRESS"`, `"RELEASE"`, `"TAP"` | `BTNPRESS <VID>`, `BTNRELEASE <VID>`, `BTN <VID>` |
| **Esecuzione Task** | `<VID>/task/vantage/set` | `"BOOT"`, `"ON"` o trigger | `TASK <VID> BOOT` |
| **Imposta Variabile** | `<VID>/variable/vantage/set`| qualsiasi valore | `VARIABLE <VID> <valore>` |
| **Sincronizza Singolo**| `<VID>/<oggetto>/vantage/sync` | qualsiasi | `GETLOAD <VID>`, `GETBLIND <VID>`, ecc. |
| **Sincronizza Tutto** | `all/vantage/sync` o `vantage/sync` | `"SYNC"` o qualsiasi | Invia le richieste di stato per tutte le entità configurate |
| **Comando Host Diretto** | *(qualsiasi topic o non specificato)* | `"LOAD 120 80"` o `"BTN 45"` | Inviato direttamente al controller Vantage |

---

## Parametri di Configurazione

### Config Node (`vantage-controller`)
- **Host / IP**: Indirizzo IP o hostname di rete del controller Vantage InFusion.
- **Porta**: Porta TCP di connessione (predefinita: `3001` per Host in chiaro, oppure `23` per Telnet).
- **Keep-Alive**: Intervallo in secondi per l'heartbeat periodico `VERSION` (predefinito: `60`).
- **Pacing Delay**: Ritardo in millisecondi tra comandi successivi inviati sulla coda (predefinito: `50`).
- **Debug**: Abilita la stampa dei log diagnostici nella console di Node-RED.

### Bridge Node (`vantage-infusion-mqtt`)
- **Luci / Carichi (VID)**: Elenco separato da virgole dei VID dei carichi luce (es. `120, 121, 122`).
- **Tapparelle (VID)**: Elenco separato da virgole dei VID delle coperture/veneziane (es. `55, 56`).
- **Sensori (VID)**: Elenco separato da virgole dei VID dei sensori (es. `141`).
- **Variabili (VID)**: Elenco separato da virgole dei VID delle variabili interne (es. `501, 502`).
- **Pulsanti (VID)**: Elenco separato da virgole dei pulsanti tastiera da resettare con `RELEASE` all'avvio.
- **Sincronizza all'avvio**: Invia automaticamente le richieste `GET...` alla connessione con il controller.
- **Sincronizzazione Periodica**: Intervallo in secondi tra le sincronizzazioni di stato forzate (predefinito: `300`).
- **Watchdog**: Monitora l'attività della connessione e imposta lo stato di connessione a `OFF` in caso di mancata risposta.
- **Auto-Discovery MQTT**: Attiva la configurazione automatica delle entità su Home Assistant.
- **Prefisso Discovery**: Prefisso MQTT (predefinito: `homeassistant`).

---

## Licenza

MIT © 2026 Bruno Leonardi
