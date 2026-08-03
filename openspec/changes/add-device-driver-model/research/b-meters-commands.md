# B METERS downlink command reference (extracted from vendor PDFs)

Source documents, both in `docs/`:

- `docs/v1.0_IWM-LR3_LR4_UM_EN (4).pdf` — *IWM-LR3 – IWM-LR4 User Manual v1.0* (21 pages). 66 devices in fleet.
- `docs/Manual-RFM_LR1_1.1.2_ENG (1).pdf` — *RFM-LR1 manual, LORAWAN module for GSD8-RFM water meter, User Manual v1.1.2* (9 pages). 2 devices in fleet.

**Extraction method.** The PDFs' text lives in two places: Latin-1 literal strings
(`(...)Tj`) and CID-keyed hex strings (`<0014005C...>Tj`) that need each font's
`/ToUnicode` CMap. A naive literal-only extraction silently drops ~40% of the
technical content — including *the entire worked-example section of the IWM manual*.
Everything below was extracted by decoding both, per page, with `Tm`/`Td` coordinates
retained so table columns could be reconstructed by x-position. Where a value is
quoted below it is verbatim from that decode.

**Headline conclusion (settles the open question in the proposal):** the two families
share *nothing*. Different framing, different header size, different opcode space,
different endianness convention, different acknowledgement semantics. They need two
separate codec definitions. See [Comparison](#comparison) at the end.

---

## Part 1 — IWM-LR3 / IWM-LR4

### 1.1 Transport

> "3. Command list descriptions (downlink)
> This describes the payload data that is sent to and from the application server. All downlink application
> communication is done on LoRaWAN **port 1**." — p.12

- **Downlink port: 1.** Stated explicitly.
- **Uplink port: NOT STATED in the manual** — the word "port" appears nowhere else in
  a protocol sense. The periodic measurement report (p.8–10) and the command answers
  (§3.x "H2R" blocks) are described without any port number.

  **RESOLVED 2026-08-03 from our own fleet: uplinks arrive on port 1.** 5,449 stored
  uplinks from 61 live devices in `raw_uplinks`, every one on `f_port = 1`. B METERS'
  own TTN codec agrees — `iwmlr3.js` handles `case 1:` and returns `unknown FPort`
  for anything else. Both directions are port 1, as on the RFM.
- LoRaWAN version: "LoRaWAN v.1.0.1 standard commands" (p.8).
- **LoRaWAN Class: NOT STATED.** The Specification table (p.7) has no Class row
  (unlike the RFM manual, which does). Class A is the safe operational assumption for
  a 10-year battery meter, but this manual does not say it.
- Activation: "Standard devices are configured as OTAA (Over The Air Activation). It is
  possible to order a batch of devices configured as ABP". Default AppEUI/JoinEUI
  `E41E0A90000FFFFF`.

### 1.2 Frame format

Every documented frame is a **5-byte header** followed by an optional payload the
manual calls the "Date" field (a mistranslation of *dati*/data — it is not a timestamp):

| Offset | Len | Field | Notes |
|---|---|---|---|
| 0 | 1 | `Fct` | Function code = the opcode (0x07, 0x0A, 0x14…). Never defined in prose, but every table puts the opcode here. |
| 1 | 1 | `C/R/A` | 0x00 = Command, 0x01 = Answer, 0x02 = Acknowledge frame |
| 2 | 1 | `Err` | Error code; 0 in requests |
| 3 | 1 | `Chain` | **Never described anywhere in the manual.** 0 in every documented frame and every worked example. |
| 4 | 1 | `Len` | Number of payload bytes that follow the header |
| 5.. | `Len` | payload | per-command, below |

Verbatim, the `C/R/A` table (p.11):

> C/R/A field:
> `0x00` | C – Command
> `0x01` | R - Answer
> `0x02` | A – Acknowledge frame

Verbatim, the `Err` table (p.12):

> Error field:
> `0x00` | No errors
> `0x03` | Wrong request. Used when an incorrect password is present.
> `0x04` | Error Length
> `0x07` | Data Error

Per-command `Err` sections add `0x01` (invalid date / out-of-range), `0x02` ("Device
TypeError. The device type is incorrect."), and `0x05` (EEPROM Write Error).

**Endianness.** Stated per-command, not globally, and only for the multi-byte
commands. The exact sentence, repeated in §3.5, §3.6, §3.7 and §3.9:

> "Data fields larger than bytes will be represented in **MSB first**."

i.e. **big-endian**. Confirmed by the worked example: 864 liters encodes as
`0x00 0x00 0x03 0x60` (0x0360 = 864).

**`Device Type` byte.** Most payloads begin with a 1-byte `Device Type property`.
Its value is `0x04` in every request table and every request example. The manual says
only "The Device Type field indicates the type of device" and never enumerates the
values. ⚠ **Inconsistency:** the §4 worked example for the 0x07 *answer* shows `0x01`
in that position, not `0x04`. Assume `0x04` when encoding requests (all six worked
request examples use it); treat the answer value as unverified.

**`Len` semantics** are confirmed arithmetically by all six worked examples: `Len` =
byte count *after* the 5-byte header.

### 1.3 Complete command table (p.11, verbatim)

The list in the task prompt was incomplete — there are **12 commands**, not 6.

| Code | Name | Description (verbatim) |
|---|---|---|
| `0x07` | `GET_FW_VERSION` | Read the fw version |
| `0x0a` | `Reset` | Command used to restart the microcontroller that manages the device |
| `0x14` | `SET_DATE_AND_TIME` | Command used for set data and time |
| `0x15` | `GET_DATE_AND_TIME` | Command used for read data and time |
| `0x16` | `SET_REVOLUTION_COUNTERS` | Command used for set the intial consumption of water meter |
| `0x17` | `GET_REVOLUTION_COUNTERS` | Command used for read the intial consumption of water meter |
| `0x1A` | `SET_METER_PAR` | Command used to set physical counter parameters |
| `0x1B` | `GET_METER_PAR` | Command used to read the physical parameters of the counter |
| `0x26` | `SET_ALARM_PAR` | Command used to set alarm detection parameters |
| `0x27` | `GET_ALARM_PAR` | Command used to read alarm detection parameters |
| `0x28` | `GET_ALARM_DATA` | Command used to read detected and stored alarm data |
| `0x29` | `SET_ALARM_DATA` | Command used to set the flags relating to the detected alarms |

Acronyms (p.11, verbatim): "R2H: Reader To Host H2R: / H2R: Host To Reader / Fw:
Firmware / Reader: transceiver LoRa".

⚠ **The R2H/H2R labels are used backwards relative to those definitions.** In every
§3.x section the **`R2H:` block is the downlink command** (C/R/A = 0 = Command) and
the **`H2R:` block is the device's uplink answer** — §3.1 even titles it
"H2R (ANSWER):". Read them by content, not by the acronym expansion.

### 1.4 Per-command payload layouts

Total length = 5 (header) + `Len`.

#### 0x07 GET_FW_VERSION — request 5 bytes / answer 9 bytes

> "The command used to read the version of the FW loaded on the card."

Request (the only command with **no** Device Type byte):

| off | len | field | value |
|---|---|---|---|
| 0 | 1 | Fct | `0x07` |
| 1 | 1 | C/R/A | `0x00` |
| 2 | 1 | Err | `0x00` |
| 3 | 1 | Chain | `0x00` |
| 4 | 1 | Len | `0x00` |

Answer: header + `Device Type` (1 byte) + `Fw Version` (3 bytes), `Len = 0x04`.
Table shows Device Type `0x04` and Fw Version `0x000008`.

Worked examples (p.21, verbatim):

> GET FW VERSION (0x07)
> R2H: `0x07, 0x00, 0x00, 0x00, 0x00`
> H2R: `0x07, 0x01, 0x00, 0x00, 0x04, 0x01, FW1, FW2, FW3`
>
> GET FW VERSION (0x07) with incorrect length
> R2H: `0x07, 0x00, 0x00, 0x00, 0x01, 0x00`
> H2R: `0x07, 0x01, 0x04, 0x00, 0x00`

The error example is the clearest statement in the manual of answer semantics:
C/R/A flips to `0x01`, `Err` = `0x04` (Length Error), `Len` = 0.

#### 0x0A RESET — request 6 bytes / **no answer**

| off | len | type | field | value |
|---|---|---|---|---|
| 0–4 | 5 | — | header | `0x0a 0x00 0x00 0x00 0x01` |
| 5 | 1 | uint8 | Device Type property | `0x04` |

> "H2R: There is no response because the microcontroller resets and the mailbox is
> re-initialized. For example, you can use this command to force the microcontroller to
> restart in order to perform a new join procedure to the network after changing the
> LoRajoinmode. Once the command has been received, the module temporarily saves the
> current date/time and consumption, resets and restores the previously saved values."

Worked example: `R2H: 0x0a 0x00 0x00 0x00 0x01 0x04` / `H2R: empty`.

**This command produces no acknowledgement of any kind.** It is the one case where a
correlation-based lifecycle has nothing to correlate against.

#### 0x14 SET_DATE_AND_TIME — request 13 bytes / answer 5 bytes

`Len = 0x08`. Payload: Device Type + 7 date bytes.

| off | len | type | field | min | max | notes |
|---|---|---|---|---|---|---|
| 5 | 1 | uint8 | Device Type property | — | — | `0x04` |
| 6 | 1 | `Uint8_t` | Day | 1 | 31 | Date Index 1 |
| 7 | 1 | `Uint8_t` | Day of the week | 0 | 6 | Date Index 2; "(0th Sunday, 1st Monday ....)" |
| 8 | 1 | `Uint8_t` | Month | 1 | 12 | Date Index 3; "(1st January, 2nd February...)" |
| 9 | 1 | `Uint8_t` | Year | 18 | 100 | Date Index 4 — offset from 2000 |
| 10 | 1 | `Uint8_t` | Hours | 0 | 23 | Date Index 5 |
| 11 | 1 | `Uint8_t` | Minutes | 0 | 59 | Date Index 6 |
| 12 | 1 | `Uint8_t` | Seconds | 0 | 59 | Date Index 7 |

**All fields are plain `Uint8_t` binary — NOT BCD.** The manual's Type column says
`Uint8_t` for every one. The example row is `0x14 | 0 | 0 | 0 | 0x08 | 0x04 | 1 | 1 |
1 | 18 | 10 | 30 | 0` (1 Jan 2018, Monday, 10:30:00) — `18` and `30` appear as
decimal 18/30, which under BCD would be 0x18/0x30; the `Uint8_t` type declaration and
the "Maximum 100 / 59 / 59" bounds settle it as plain binary.

Answer: header only, `Len = 0x00`.
Err values: 0x00, 0x01 (Invalid date error), 0x02, 0x03, 0x04.

"Date Index" throughout this manual = 1-based byte offset within the payload
*after* the Device Type byte.

#### 0x15 GET_DATE_AND_TIME — request 6 bytes / answer 13 bytes

Request: header + Device Type. ⚠ The request table on p.14 rendered as headings only
("R2H: HEADER property | Date") — the byte row did not survive extraction, but by
symmetry with 0x17/0x1B/0x27/0x28 it is `0x15 0x00 0x00 0x00 0x01 0x04`. **This
particular request row is inferred, not quoted.**

Answer: `0x15 | 0 | 0 | 0 | 0x08 | 0x04 | Day | DoW | Month | Year | Hours | Minutes |
Seconds` — same 7-byte date layout as 0x14.

#### 0x16 SET_REVOLUTION_COUNTERS — request 11 bytes / answer 5 bytes

> "The command used to set the initial value of the counters. Data fields larger than
> bytes will be represented in MSB first."

`Len = 0x06`.

| off | len | type | field | notes |
|---|---|---|---|---|
| 5 | 1 | uint8 | Device Type property | `0x04` |
| 6 | 4 | `Uint32_t` **big-endian** | Forward counter | min 0, max "9.9999.9999" (sic; intended 99,999,999) |
| 10 | 1 | `Uint8_t` | Reset Backward | "0 - Do not reset" / "1 - Reset counter" |

Scaling is carried in the **top two bits of the 32-bit Forward counter** (verbatim):

> "The 31 and 30 bits of the Forward counter field have the following meaning:
> `0b00` - Counter expressed in Litres (value is allowed only if the setting of the K is 1)
> `0b01` - Counter expressed in decalitres (value is allowed only if the setting of The K is 10)
> `0b10` - Counter in hectolitres (the value is allowed only if the setting of the K is 100)
> `0b11` - Not allowed"

So the counter value occupies bits 29..0 and the unit selector bits 31..30, and the
selector **must agree with the meter's configured K index** (set via 0x1A).

Worked example (p.21):

> SET_REVOLUTION_COUNTERS (0x16) → 864 liters as initial consumption
> R2H: `0x16 0x00 0x00 0x00 0x06 0x04 0x00 0x00 0x03 0x60 0x00`
> H2R: `0x16 0x01 0x00 0x00 0x00`

`0x00000360` = 864, top two bits `0b00` = litres. ✔ big-endian confirmed.

Err: 0x00, 0x01 (Out-of-range counter error), 0x02, 0x03, 0x04.

#### 0x17 GET_REVOLUTION_COUNTERS — request 6 bytes / answer see warning

Request: `0x17 0x00 0x00 0x00 0x01 0x04`.

Answer table (p.16), `Len = 0x09`, C/R/A = 1:

| off | len | field |
|---|---|---|
| 5 | 1 | Device Type |
| 6 | 4 | Forward counter |
| 10 | ? | Backward Counter |

⚠ **The manual contradicts itself here.** The byte-width row reads
`1 byte | 1 byte | 1 byte | 1 byte | 1 byte | 1 byte | 4 bytes | 1 byte`, which sums to
a 6-byte payload — but the same row states `Len = 0x09`. `Len = 0x09` only balances if
**Backward Counter is 4 bytes**, not 1. There is no worked example for 0x17 to break
the tie. **Do not hard-code this offset without capturing a real device response.**
(This is a *decode* concern only; the encoder side of 0x17 is unambiguous.)

Same 31/30-bit unit selector applies to the answer's Forward counter, and:

> "The backward counter field is always expressed in liters."

#### 0x1A SET_METER_PAR — request 10 bytes / answer 5 bytes

> "The command used to set the physical parameters of the counter. Data fields larger
> than bytes will be represented in MSB first."

`Len = 0x05`. Column order confirmed by x-coordinate: Reserved is **last**.

| off | len | type | field | values |
|---|---|---|---|---|
| 5 | 1 | uint8 | Device Type property | `0x04` |
| 6 | 1 | `Uint8_t` | Active | 0 = Inactive count, 1 = Active Count |
| 7 | 1 | `Uint8_t` | K Index | 0 = 1 litre, 1 = 10 litres, 2 = 100 litres |
| 8 | 1 | `Uint8_t` | Medium | 0 = Water, 1 = Hot water |
| 9 | 1 | uint8 | Reserved, For | `0x00` |

Answer: header only, `Len = 0x00`.
Err: 0x00, 0x01, 0x02, 0x03, 0x04, 0x05 (EEPROM Write Error).

#### 0x1B GET_METER_PAR — request 6 bytes / answer 10 bytes

Request `0x1B 0x00 0x00 0x00 0x01 0x04`; answer mirrors 0x1A's payload exactly
("In the date field, the fields have the same meaning as the previous SET_METER_PAR
command"), `Len = 0x05`.

#### 0x26 SET_ALARM_PAR — request 14 bytes / answer 5 bytes

`Len = 0x09` — Device Type (1) + `AlarmPar, Ism` (8 bytes):

| off | len | type | field | default | min | max | meaning |
|---|---|---|---|---|---|---|---|
| 5 | 1 | uint8 | Device Type | — | — | — | `0x04` |
| 6 | 1 | `Uint8_t` | Alarm Threshold Reverse | 0x00 | 0x00 | 2 | 0 = 20 litres, 1 = 50 litres, 2 = 100 litres |
| 7 | 1 | `Uint8_t` | Loss Control Time | 0x00 | 0x00 | 3 | 0 = 6 hours, 1 = 12 hours, 2 = 24 hours, 3 = 48 hours |
| 8 | 1 | `Uint8_t` | Transmission VIF | 0x00 | 0x00 | 3 | 0 = litres (0x13), 1 = Decalitres (0x14), 2 = hectolitres (0x15), 3 = m³ (0x16) |
| 9 | 1 | `Uint8_t` | Temperature | 0x00 | 0x00 | 0x00 | "0 disable; 1 enable" |
| 10 | 4 | `Uint32_t` big-endian | Low battery threshold | 2200 | 0x00000000 | 0xffffffff | "Threshold in mV" |

(Date Index column: 1, 2, 3, 4, "5 – 8" respectively — confirming the 4-byte
threshold occupies the last four payload bytes.)

⚠ Note the manual prints "Maximum 0x00" for the Temperature field while its
Description column says "0 disable; 1 enable". Treat max as 1.

Two worked examples, and **they disagree with each other on the last four bytes**:

> (p.9) `Eg. 26 00 00 00 09 04 00 00 00 01 00 00 00 00` → Enable
> (p.9) `Eg. 26 00 00 00 09 04 00 00 00 00 00 00 00 00` → Disable
> (p.21) SET_ALARM_PAR (0x26) → Temperature bytes enabled.
> R2H: `0x26 0x00 0x00 0x00 0x09 0x04 0x00 0x00 0x00 0x01 0x02 0x02 0x00 0x00`
> H2R: `0x26 0x01 0x00 0x00 0x00`

p.9 sets the threshold to 0; p.21 sets it to `0x02020000` = 33,685,504 mV, which is
nonsense as a battery voltage, and neither matches the documented default of 2200 mV
(`0x00000898`). The field *offsets* are consistent across all three; only the example
*values* are junk. p.9 warns about exactly this:

> "N.B: Pay attention to the meaning of the other parameters (for example the last 4
> bytes are the low battery threshold). Refer to the supplement 'integrators' document:
> request it directly from B METERS."

**Practical consequence: 0x26 is a whole-struct write with no read-modify-write
support.** Sending it to toggle the temperature flag silently overwrites the reverse-flow
threshold, loss-control time, VIF and battery threshold. Any UI exposing this command
must `GET_ALARM_PAR (0x27)` first and re-send the other seven bytes unchanged.

#### 0x27 GET_ALARM_PAR — request 6 bytes / answer 14 bytes

Request `0x27 0x00 0x00 0x00 0x01 0x04`; answer `Len = 0x09`, same 8-byte AlarmPar
struct ("In the AlarmPar field, the data has the same meaning as the previous
SET_ALARM_PAR command").

#### 0x28 GET_ALARM_DATA — request 6 bytes / answer 34 bytes

Request `0x28 0x00 0x00 0x00 0x01 0x04`. Answer `Len = 0x1D` (29) = Device Type (1) +
`AlarmData` (28 bytes):

| Date Index | off | len | type | field |
|---|---|---|---|---|
| 1 – 4 | 6 | 4 | `Uint32_t` | Alarm Flags (max `0x3F`) |
| 5 – 8 | 10 | 4 | `Uint32_t` | Magnetic Alarm Date (dd/mm/yy) |
| 9 – 12 | 14 | 4 | `Uint32_t` | Form Removal Alarm Date (dd/mm/yy) |
| 13 – 16 | 18 | 4 | `Uint32_t` | Blinding Alarm Date (dd/mm/yy) |
| 17 – 20 | 22 | 4 | `Uint32_t` | Date Detection/Loss Resolution (dd/mm/yy) |
| 21 – 24 | 26 | 4 | `Uint32_t` | Reverse Flow Alarm Date (dd/mm/yy) |
| 25 – 28 | 30 | 4 | `Uint32_t` | Low battery alarm date (dd/mm/yy) |

Alarm Flags bitfield (verbatim): "Bit 0: magnetic / Bit 1: Removal / Bit 2: Blinding /
Bit 3: Loss bit / Bit 4: Reverse stream / Bit 5: Low battery".

⚠ The date fields are typed `Uint32_t` and described only as "dd/mm/yy". The manual
never says how a dd/mm/yy date packs into 4 bytes and gives no worked example.

**RESOLVED 2026-08-03 from real device captures.** Nine `0x28` answers from live
IWM-LR3/LR4 meters were posted to the ChirpStack forum
([thread 22344](https://forum.chirpstack.io/t/convert-dates-decoding-an-pplink-after-a-downlink-bmeter-iwm-lr3-4/22344),
October 2024). The packing is **not** an epoch — it is four plain binary bytes:

| off | len | field |
|---|---|---|
| 0 | 1 | Day (1-31) |
| 1 | 1 | Month (1-12) |
| 2 | 1 | Year, offset from 2000 |
| 3 | 1 | `0x00`, always |

Same plain-`Uint8_t` convention the manual already uses for `0x14 SET_DATE_AND_TIME`,
which is why it was never going to be BCD or an epoch.

Verified across all 9 frames × 6 date fields — **54 fields, zero invalid**: every day
1-31, every month 1-12, every year `0x12`-`0x18` (2018-2024, and the thread is from
October 2024). Corroborated independently by the Alarm Flags: in every frame where a
flag bit is set, that alarm's own date field is populated. Example, frame 6:

```
28 01 00 00 1D 04 | 00 00 00 08 | 00000000 | 18 09 18 00 | 00000000 | 1C 09 18 00 | ...
                     flags=0x08                removal                 loss
                     (bit 3 = Loss)            24/09/2024              28/09/2024
```

The forum poster's error was reading the four bytes as a big-endian `uint32` epoch,
which produced dates in 1971-1973.

This meets the bar this document set — a real device capture — so the IWM decoder is
**no longer blocked** on the integrators' supplement for this field. Dates from *our*
own meters should still be checked against this the first time we read one.

#### 0x29 SET_ALARM_DATA — request 10 bytes / answer 5 bytes

> "Command used to set the flags relating to the detection of alarms."

`Len = 0x05`:

| off | len | type | field |
|---|---|---|---|
| 5 | 1 | uint8 | Device Type | `0x04` |
| 6 | 4 | `Uint32_t` big-endian | Alarm Flags (max `0x0000003F`) |

Same bit assignments as 0x28. Writing 0 clears all alarms.

Worked example (p.21):

> SET_ALARM_DATA (0X29) reset all alarms
> R2H: `0x29 0x00 0x00 0x00 0x05 0x04 0x00 0x00 0x00 0x00`
> H2R: `0x29, 0x01, 0x00, 0x00, 0x00`

### 1.5 Confirmed vs unconfirmed downlink

**NOT STATED.** The words "confirmed", "unconfirmed", "ACK" (in the LoRaWAN MAC sense)
and "downlink acknowledgement" do not appear anywhere in the IWM manual. The manual
defines an *application-layer* answer (C/R/A) but says nothing about the LoRaWAN MAC
confirmed-downlink flag. This is an integration decision, not a documented constraint.

### 1.6 Response / acknowledgement behaviour — the important bit

The IWM devices **do answer** commands, at the application layer:

- The answer's first byte is the **same `Fct` opcode** as the command.
- The answer's `C/R/A` byte is `0x01` ("R - Answer").
- The answer's `Err` byte carries the outcome (`0x00` = No errors).
- `0x0A RESET` **has no answer at all** ("H2R: empty").

**There is no correlation identifier.** The only thing linking an answer to a command is
the opcode, and `Chain` (undescribed, always 0) is the only field that could plausibly
have served that role. Two concurrent 0x27 queries to the same device are
indistinguishable in their replies.

Implication for the platform's command lifecycle: it cannot rely on a device-echoed
correlation id here. Matching has to be *(device, opcode, outstanding-since)* with at
most one in-flight command per (device, opcode) — and `0x0A RESET` must be modelled as
fire-and-forget with no terminal ACK state, or it will hang in "pending" forever.

⚠ Two more table-vs-example inconsistencies affecting any decoder: the answer tables
for 0x14, 0x15, 0x16, 0x17, 0x1A, 0x1B, 0x27 and 0x28 print `C/R/A = 0`, while the
tables for 0x26 and 0x29 print `1` and **all five worked examples show `0x01`**. Treat
the `0` entries as copy-paste errors and match answers on `C/R/A == 0x01`.

### 1.7 Downlink timing constraints

The manual describes a state machine, not a queueing model (p.2):

> "Module status and state check
> The sensor has four status: Initial, Joining, Configure and Operational state.
> INITIAL → [+/-5 index revolutions] → JOINING → [Connected to LoRaWAN network] →
> CONFIGURE → [Polled network configuration commands during 2 minutes] → OPERATIONAL
> ( Reset (OTA or NFC) returns to INITIAL )
>
> Start-up Sequence
> When the device has joined the network, startup transmissions are performed to make it
> easier to configure the device using downlink commands. When the startup sequence is
> completed normal operation is started.
> The full joining procedure should take maximum 20 minutes.
> The module starts transmitting with Spreading Factor (SF) 12, for maximum performance.
> It will then automatically adjust the SF up to a minimum of SF7 in order to balance
> performance and energy consumptions."

Practical constraints:

- **A ~2-minute CONFIGURE window right after join** is the only period with frequent
  uplinks, hence the only period with frequent RX slots. This is the intended window
  for provisioning commands (0x14, 0x16, 0x1A, 0x26).
- **In OPERATIONAL state, uplinks are every 12 hours** by default: "Transmission
  intervals: 12 hours, configurable via NFC" (p.7). Note **via NFC** — unlike the RFM,
  the IWM's reporting interval is **not** settable over the air; there is no such
  downlink command in the list.
- Consequence: a downlink queued in OPERATIONAL state may sit for **up to 12 hours**
  before the device opens an RX window. Command timeouts must be at least
  interval-plus-margin, and the UI must set that expectation.
- `0x0A RESET` forces a re-join, i.e. re-enters the 2-minute CONFIGURE window — the
  manual explicitly frames it as the way to do that.
- Nothing is said about downlink queue depth, per-uplink downlink limits, or duty cycle.

---

## Part 2 — RFM-LR1

### 2.1 Transport

> "Downlink commands and queries
> This describes the payload data that is sent to and from the application server. All
> downlink application communication is done on LoRaWAN port 1" — p.6

- **Downlink port: 1.**
- **Uplink port: 1** — stated for the unsolicited status uplink: "Port: Port 1 /
  Payload 0x01 20 00" (p.6). Both directions are port 1.
- LoRaWAN version: "LoRaWAN v.1.0.2 standard commands".
- **LoRaWAN Class: A.** The Specification table (p.5) has an explicit `Class` row whose
  value is `A`. (This manual also reproduces the full LoRaWAN 1.0.2 MAC command table
  on p.9 — LinkCheckReq, LinkADRReq, DutyCycleReq, RXParamSetupReq, DevStatusReq,
  NewChannelReq, RXTimingSetupReq and their Ans forms.)
- Activation: OTAA default, ABP on request. Default AppEUI/JoinEUI
  `70-B3-D5-D7-2F-F8-1301`.

### 2.2 Frame format — completely different from the IWM

**2-byte header, no length field, no error field, no Device Type.**

Downlink (verbatim table, p.6):

> Downlink command network => device
> `Type` | 1 byte | `0x01`: Set, `0x02`: Query, `0x03`: Action
> `Index` | 1 byte | Command Index
> `Data` | As defined for Command Index — only applicable for set-commands

Uplink (verbatim table, p.6):

> Uplink command device => network
> `Type` | 1 byte | `0x01`: Data, `0x02`: Command NACK
> `Index` | 1 byte | Command Index
> `Data` | As defined for Command Index (only for Type: Data)

| Offset | Len | Field |
|---|---|---|
| 0 | 1 | `Type` — downlink: 0x01 Set / 0x02 Query / 0x03 Action; uplink: 0x01 Data / 0x02 Command NACK |
| 1 | 1 | `Index` — the command index (see table below) |
| 2.. | n | `Data` — width and encoding fixed per Index; present only for Set (downlink) and Data (uplink) |

**Endianness: big-endian**, declared per-field in the Datatype column ("Uint16 Big
endian", "Uint32 Big endian").

**Frames concatenate.** A single uplink may carry several `Type|Index|Data` triples
back to back — see the second worked example below. The decoder must loop, using each
Index's known data width to advance. There is no length byte to help.

### 2.3 Complete command table (p.7, verbatim, columns realigned by x-position)

| Index | Description | Datatype | Encoding | Valid range | Access | Unsolicited | Description |
|---|---|---|---|---|---|---|---|
| `0x03` | FW build hash | 6 x Uint8 | — | — | Query | No | Unique number that identifies the firmware version |
| `0x05` | Device reset | — | — | — | Action | No | Reset of device |
| `0x06` | CPU voltage | Uint8 | 25mV/LSB | 0 – 3.6V | Query | No | Read CPU voltage. Max/min ranges depend on battery chemistry. |
| `0x0A` | CPU temperature | Uint16 Big endian | 0.01C / LSB | -50 – +125 C | Query | No | Temperature from CPU sensor with 50 °C offset. Approximately 5 °C accuracy |
| `0x20` | Status | Uint8 | Bitfield | — | Set, Query | **Yes** | see bitfield below |
| `0x21` | Volume | Uint32 Big endian | Liter | — | Query | **Yes** | Volume as indicated on meter x 0.001 m3 |
| `0x22` | Reporting interval | Uint16 Big endian | Minutes | 1-10080 | Set, Query | No | Reporting interval in minutes |
| `0x25` | Starting value | Uint32 Big endian | Liter | — | Set, Query | No | Volume as indicated on meter x 0.001 m3 |
| `0x27` | Back flow volume | Uint32 Big endian | Liter | — | Query | No | Volume as indicated on meter x 0.001 m3 |
| `0x2B` | Q3MaxFlow | Uint16 Big endian | Liters per hour | 0 – 65535 | Set, Query | No | Corresponds to mechanical meter Q3 (based on pipe) |
| `0x2C` | Leak Window size | Uint8 | Number of 15 seconds samples | 1 – 255 | Set, Query | No | The size, in units of 15 seconds sample windows, in which we expect flow below "zero tolerance" to reset leak detection |
| `0x2D` | Leak Zero tolerance | UInt8 | Opto phase changes | 0 – 255 | Set, Query | No | Zero tolerance, max number of shaft phase changes considered "not moving" |

So the **settable** (encodable) commands are exactly: `0x20` Status, `0x22` Reporting
interval, `0x25` Starting value, `0x2B` Q3MaxFlow, `0x2C` Leak Window size, `0x2D` Leak
Zero tolerance — plus the one Action, `0x05` Device reset. Everything else is
query-only.

`0x20` Status bitfield (verbatim):

> Bit 7: Flow exceeds Q3 at least for 10 min
> Bit 6: -
> Bit 5: Magnetic fraud attempt
> Bit 4: -
> Bit 3: Module removed
> Bit 2: -
> Bit 1: -
> Bit 0: Leakage during last 24 hours
>
> To clear alarms: 0xFF clears no alarms, 0x00 clears all alarms, 0x80 clears all alarms
> except "module removed" etc.

Note the inverted clear semantics: **the written byte is a mask of alarms to *keep*.**
Also stated on p.4: "The alarm flags are reset by setting the Status data with a
Downlink command. Setting it to 0 resets all alarms. Setting it to 0xFE resets alarm
flag 0."

The unsolicited startup status payload (p.6):

> Payload `0x01 20 00`
> `0x01`: Data type
> `0x20`: Status command
> `0x00`: bit0 = 0 => Normal startup / bit1 = 0 => No boot problem / bit2-7 reserved
> The expected behavior is `0x01 20 00`.

⚠ Note that the same `0x20` byte carries **two different bit meanings** depending on
context: the alarm bitfield above, and this startup/boot diagnostic. The manual does
not reconcile them.

### 2.4 Worked examples (p.8, verbatim) — all verified

> Uplink: `012100001738` — Normal Volume with the meter reading 5944 liter
> Uplink: `012100001738012008` — Normal Volume with the meter reading 5944 liter combined with Status data indicating Module removed alarm flag
> Downlink: `012000`  Uplink: `012000` — Resets all alarm flags
> Downlink: `012205A0`  Uplink: `012205A0` — Sets the Reporting interval to 1440 minutes = 24 hours.
> Downlink: `0227`  Uplink: `012700000017` — Query the Back flow volume. The reply is 23 liter.
>
> Reset device
> The device can be remotely reset and forced into Joining state. All settings are back to factory default.
> Example
> Remote device reset: Port 1: `0305`

Decoded and checked:

| Frame | Type | Index | Data | Check |
|---|---|---|---|---|
| `01 21 00001738` | Data | Volume | 0x1738 = 5944 | ✔ matches "5944 liter" |
| `01 21 00001738` `01 20 08` | Data + Data | Volume + Status | 0x08 = bit 3 | ✔ "Module removed" — **and confirms frames concatenate** |
| `01 20 00` | Set | Status | 0x00 | ✔ "clears all alarms" |
| `01 22 05A0` | Set | Reporting interval | 0x05A0 = 1440 | ✔ big-endian uint16 |
| `02 27` | Query | Back flow volume | — | ✔ query carries no data |
| `01 27 00000017` | Data | Back flow volume | 0x17 = 23 | ✔ big-endian uint32 |
| `03 05` | Action | Device reset | — | ✔ 2-byte action frame |

The encoding is fully self-consistent. No unresolved offsets on this device.

### 2.5 Confirmed vs unconfirmed downlink

**NOT STATED.** The manual never uses "confirmed"/"unconfirmed" for application
downlinks. It does reproduce the LoRaWAN 1.0.2 MAC command list on p.9, but that is
standard MAC, unrelated.

### 2.6 Response / acknowledgement behaviour

The RFM-LR1 **echoes**:

- A successful **Set** is answered with `0x01 <Index> <the same data>` — the examples
  show `Downlink: 012205A0` → `Uplink: 012205A0` and `Downlink: 012000` → `Uplink:
  012000`. Note the echo's Type byte is also `0x01`, since 0x01 means "Set" downlink
  and "Data" uplink; the bytes are literally identical.
- A **Query** is answered with `0x01 <Index> <value>`.
- A **rejected** command is answered with `0x02 <Index>` — Type `0x02` = **"Command
  NACK"**. This is the only explicit negative-acknowledgement in either manual.
- `0x03 0x05` (Device reset) — no answer is documented, and the device re-joins with
  factory-default settings, so none should be expected.

**Correlation is again by Index only**, not by a generated id. But the Set echo returns
the *full written value*, which is stronger than the IWM: a Set can be verified
end-to-end by byte comparison, and a NACK is unambiguous. This is the closest either
device gets to a usable ack.

### 2.7 Downlink timing constraints

Class A, and the manual is unusually explicit (p.2–3, 6):

> "The sensor has four states: Initial, Joining, Configure and Operational state.
> INITIAL → [Press button for 3 sec] → JOINING → [Connected to LoRaWAN network] →
> CONFIGURE → [Polled network configuration commands during 2 min] → OPERATIONAL
> ( Remote reset (OTA) or Re-join returns to JOINING )
>
> Re-join functionality
> The device supervises its connectivity to the network, by monitoring that periodic
> downlink messages are received. The device tries to re-join the network if it has not
> heard anything from the network for 288 uplinks (~ 36 days)."

> "There are at least five startup transmissions. The Status command (index 0x20) is sent
> unless a reply to a downlink is sent. If no replies are sent the Status commands are
> sent with increasing intervals starting with 15 seconds and ending with two minutes.
> This startup sequence should be utilized to set the starting value of the water meter
> (if not equal to 0 m3). For accurate calibration, the water meter should not be used
> during the calibration."

> "The sensor polls the server for configuration parameters during the Configure state.
> This is done by sending unsolicited uplink status report (0x20)… After approximately 2
> minutes the device changes to Operational state."

Practical constraints:

- **CONFIGURE window: ~2 minutes after join**, with at least five uplinks at
  15s → 2min increasing intervals. This is the documented window for configuration
  downlinks, and specifically the intended window for `0x25` Starting value.
- **OPERATIONAL: default 4-hour reporting interval** ("Transmission intervals: 4 hours,
  configurable over the air") — settable over the air via `0x22`, range 1–10080 minutes
  (1 min to 7 days). A queued downlink waits up to one reporting interval.
- **The device expects periodic downlinks.** It re-joins if it hears nothing from the
  network for 288 uplinks (~36 days). Worth knowing: a network server configured to
  never send downlinks will cause periodic re-joins.
- Nothing about queue depth or duty cycle.

---

## Comparison

**They do not share a command set, a payload format, or a framing convention. They
require two entirely separate codec definitions.** There is no meaningful shared
abstraction below "B METERS LoRaWAN water meter".

| | IWM-LR3/LR4 | RFM-LR1 |
|---|---|---|
| Header | **5 bytes**: Fct, C/R/A, Err, Chain, Len | **2 bytes**: Type, Index |
| Opcode field | byte 0 (`Fct`) | byte 1 (`Index`) |
| Verb encoding | implicit in the opcode (`SET_*` / `GET_*` are separate opcodes) | explicit `Type` byte (Set / Query / Action) over a shared Index |
| Length field | yes (`Len`) | no — widths implied by Index |
| Error field | yes, in-band `Err` byte | no — a separate `0x02` NACK frame type |
| Device Type byte | yes, first payload byte on most commands (`0x04`) | none |
| Endianness | big-endian ("MSB first") | big-endian ("Big endian") |
| Opcode space | 0x07, 0x0A, 0x14–0x17, 0x1A, 0x1B, 0x26–0x29 | 0x03, 0x05, 0x06, 0x0A, 0x20–0x2D |
| Overlapping codes | `0x0A` = RESET | `0x0A` = CPU temperature (query) |
| | `0x07` = GET_FW_VERSION | `0x03` = FW build hash |
| Multi-frame payloads | not documented | yes, frames concatenate in one uplink |
| Downlink port | 1 | 1 |
| Uplink port | **not stated** | 1 |
| LoRaWAN version | 1.0.1 | 1.0.2 |
| Class | **not stated** | A (explicit) |
| Default report interval | 12 h, **NFC-only** to change | 4 h, changeable OTA via `0x22` |
| Ack on success | opcode echo, `C/R/A = 0x01`, `Err = 0x00` | full frame echo (Type+Index+data) |
| Ack on failure | same frame with non-zero `Err` | `0x02 <Index>` NACK |
| Ack absent | `0x0A RESET` only | `0x03 0x05` Device reset only |
| Correlation id | **none** (opcode only) | **none** (index only) |

Note the **direct opcode collision**: byte `0x0A` means "reset the microcontroller" on
an IWM and "read CPU temperature" on an RFM. Any codec registry must be keyed on device
family before opcode; a single flat opcode table would be actively dangerous.

### What this means for the command lifecycle

1. **Neither device echoes a correlation id.** The platform cannot tag a command with a
   generated id and match it on return. Correlation must be
   *(device_id, family, opcode/index)* with **at most one in-flight command per
   (device, opcode)**, plus a timeout.
2. **Timeouts must be interval-scaled, not fixed.** Worst case is one reporting
   interval: up to 12 h (IWM, not adjustable over the air) or up to the configured
   `0x22` value (RFM, default 4 h, max 7 days). A 30-second or 5-minute command timeout
   is wrong for both.
3. **Two commands can never reach a terminal ACK state**: IWM `0x0A RESET` and RFM
   `0x03 0x05 Device reset`. Model them as fire-and-forget.
4. **The RFM gives a real negative ack** (`0x02 <Index>`); the IWM signals failure via
   the `Err` byte of an otherwise-normal answer. Both need mapping into the lifecycle's
   failure state, by different rules.
5. **IWM `0x26 SET_ALARM_PAR` and `0x1A SET_METER_PAR` are whole-struct writes.** Any
   command that exposes a single setting from these must GET-modify-SET, or it will
   silently clobber neighbouring configuration.
6. **The CONFIGURE window (~2 min post-join) is the only reliable provisioning window**
   on both families. Provisioning commands (IWM `0x14`/`0x16`/`0x1A`/`0x26`, RFM `0x25`)
   should be queued *before* or during that window, not after.

### Gaps that must be closed before shipping an encoder

Ordered by risk:

| # | Gap | Device | Impact |
|---|---|---|---|
| ~~1~~ | ~~`0x28 GET_ALARM_DATA` date fields~~ | IWM | **CLOSED 2026-08-03** — day/month/year-2000/`0x00`, verified over 54 captured fields. See §1.4. |
| 2 | `0x17` answer: `Len = 0x09` contradicts the byte-width row (sums to 6). Backward Counter is 1 or 4 bytes | IWM | Cannot decode counters reliably. Decode-only. |
| ~~3~~ | ~~Uplink port unknown~~ | IWM | **CLOSED 2026-08-03** — port 1, from 5,449 of our own uplinks. See §1.1. |
| 4 | `Device Type` values unenumerated; tables say `0x04`, one example says `0x01` | IWM | Use `0x04` (six worked examples agree); verify on first live command. |
| 5 | `Chain` field never described | IWM | Send `0x00` (every example does). |
| 6 | Confirmed vs unconfirmed downlink unspecified | both | Integration choice; start unconfirmed, revisit if delivery is unreliable. |
| 7 | Password mechanism referenced by error `0x03` ("Wrong request. Used when an incorrect password is present") but **no password field appears in any documented frame** | IWM | Unknown whether a password must be presented before writes. Ask the vendor. |
| 8 | `0x26` example values are internally inconsistent and contradict the documented 2200 mV default | IWM | Never copy the manual's example bytes; always compute from `0x27` read-back. |

Gaps 1, 2, 7 and the p.9 note all point at the same missing artefact. The IWM manual
names it directly:

> "Refer to the supplement 'integrators' document: request it directly from B METERS."

**Recommendation: request the B METERS integrators' document (ticket@bmeters.com)
before implementing the IWM decoder.** The RFM-LR1 encoder can be built from this
manual alone — its worked examples verify every field.

*Update 2026-08-03: gaps 1 and 3 have since been closed from real captures without
the supplement. It is still worth requesting for gaps 2 and 7.*

---

## Part 3 — B METERS' own published codec, and why we do not use it

B METERS publish an IWM-LR3 codec in TTN's device repository
([`vendor/b-meters/`](https://github.com/TheThingsNetwork/lorawan-devices/tree/master/vendor/b-meters)):
`iwmlr3.js`, `iwmlr3-codec.yaml`, an 868 profile, and device metadata. Checked
2026-08-03. **It is wrong for our fleet, in two independent ways.**

### It reads the wrong VIF values

The codec branches on the unit byte at offset 11 being `0x0D`, `0x0E` or `0x0F`:

```js
if (input.bytes[11] === 0x0D) { data.vif = input.bytes[11]*1; }        // litres
else if (input.bytes[11] === 0x0E){ data.vif = input.bytes[11]*10; }   // decalitres
else if (input.bytes[11] === 0x0F) { data.vif = input.bytes[11] * 100; }
```

**Our 61 live meters send `0x13`** — which is what the manual says (§1.4, `0x26`
Transmission VIF: 0 = litres `0x13`, 1 = decalitres `0x14`, 2 = hectolitres `0x15`,
3 = m³ `0x16`), and what our own declarative decoder already uses via
`scale_exponent_base: 19`. Against a real payload the published codec falls through
every branch and leaves `vif` undefined.

Note also that the arithmetic is nonsense even on its own terms: it multiplies the
*VIF code* by the unit factor, yielding 13, 140 and 1500 rather than a scale.

### Its worked example does not match its own code

`iwmlr3-codec.yaml` gives one example. Running the codec on that example's input:

```
input   : [0x2C,0x4A,0x20,0x01,0x00,0x22,0x01,0x00,0x00,0x00,0x00,0x0D,0x02]
actual  : {"application":44,"valueCounter":73802,"flowCounter":290,...}
claimed : {aplication:44, valueCounter:00012074, flowCounter:00000134,...}
```

The expected outputs were hand-written mixing hex and decimal within one number
(`0x4A` rendered as "74", `0x22` as "34"), and the field name is misspelled
`aplication` against the code's `application`.

### What it is still good for

It confirms the uplink port (`case 1:`) and the 13-byte periodic-report layout —
application, `valueCounter`, `flowCounter`, `indexK`, `medium`, `vif`, `alarm` — which
matches our decoder's field offsets exactly. It is corroboration of structure, not a
codec to adopt.

**Consequence for the driver model:** this is evidence for the script-codec path
rather than against it. A sandboxed vendor codec that is wrong fails visibly and
degrades to "payload undecodable" for one message; a hand-transcription of the same
wrong codec is silently wrong forever. It is also a reminder that "official vendor
codec" is not a synonym for "correct".
