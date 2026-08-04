# Windows setup

Convyder needs two things set up manually on Windows before the two
translation pipelines can run: a Python install for the backend, and a
virtual audio cable pair for routing. There's no setup wizard for the
audio side yet (`DeviceSetup.tsx` — see `CLAUDE.md` build order, step 4)
so this is a one-time manual configuration.

## 1. Prerequisites

- **Node.js** (LTS 20+) — only needed if building from source.
- **Python 3.9–3.12** from python.org, with **"Add python.exe to PATH"**
  checked during install. Convyder's first-run setup screen creates a
  venv and installs `backend/requirements.txt` into it automatically —
  it just needs a `python` on PATH to start from
  (`electron/src/main/setup-process.ts`).

## 2. Virtual audio cables

The outgoing and incoming pipelines are two independent audio paths that
must never cross (see `CLAUDE.md`'s audio routing constraint):

1. Your real mic → outgoing pipeline → synthesized speech → **a virtual
   mic** → meeting app's microphone input
2. Meeting app's speaker output → **a virtual capture device** →
   incoming pipeline → your headphones

That's two separate virtual devices, not one. A plain VB-CABLE install
only gives you a single Input/Output pair, which isn't enough to keep
both paths separate.

**Install [VB-CABLE A+B](https://vb-audio.com/Cable/) instead** — it
installs two independent pairs, `CABLE-A` and `CABLE-B`. Reboot if
prompted.

## 3. Point the meeting app at the cables

In Google Meet's or Teams' own audio settings (not Windows' system-wide
default device):

- **Microphone** → `CABLE-A Output`
- **Speaker** → `CABLE-B Input`

## 4. Configure Convyder

Launch Convyder, grant the microphone permission prompt (device names
won't show up until you do — `electron/src/renderer/audio/useAudioDevices.ts`),
then in the Settings panel:

| Settings panel field | Set to |
|---|---|
| Your mic | your real physical microphone |
| Virtual mic out | `CABLE-A Input` |
| Meeting audio in | `CABLE-B Output` |
| Your headphones | your real headphones |

With this wiring: Convyder plays translated speech into `CABLE-A Input`,
which the meeting app picks up as its microphone via `CABLE-A Output`.
The meeting app plays incoming audio into `CABLE-B Input`, which Convyder
captures via `CABLE-B Output` and translates for your headphones. Nothing
feeds back into the virtual mic.
