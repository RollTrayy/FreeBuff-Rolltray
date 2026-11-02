import streamDeck from "@elgato/streamdeck";

import { CcDialAction } from "./actions/cc-dial";
import { SendCcAction } from "./actions/cc";
import { SendNoteAction } from "./actions/note";
import { midiBridge } from "./midi/bridge";

streamDeck.actions.registerAction(new SendNoteAction());
streamDeck.actions.registerAction(new SendCcAction());
streamDeck.actions.registerAction(new CcDialAction());

// Starts the CoreMIDI helper (virtual "Stream Deck MIDI" port) before the first key press.
midiBridge.start();

streamDeck.connect();
