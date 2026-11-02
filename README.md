# MIDI Deck — plugin Stream Deck MIDI (macOS)

Un plugin Stream Deck minimaliste pour envoyer du **MIDI** vers n'importe quel DAW
(Ableton Live, Logic, Reaper, Bitwig, Pro Tools, MainStage…).

Au démarrage, le plugin crée un **port MIDI virtuel nommé `Stream Deck MIDI`** via CoreMIDI.
Rien à configurer dans Audio MIDI Setup, pas de bus IAC à créer : le port apparaît
tout seul dans la liste des entrées MIDI de vos applications, et disparaît quand
Stream Deck s'arrête.

## Trois actions

| Action | Contrôleur | Ce qu'elle fait |
| --- | --- | --- |
| **MIDI Note** | touche | Envoie une note (note on / note off), soit pendant une durée fixe, soit pendant l'appui |
| **MIDI CC** | touche | Envoie un contrôleur : déclenchement simple, bascule A/B ou momentané |
| **MIDI CC Dial** | molette Stream Deck + | Potentiomètre : chaque cran envoie une nouvelle valeur de CC, affichée sur l'écran |

### Réglages — MIDI Note

| Réglage | Défaut | Détail |
| --- | --- | --- |
| Canal | 1 | 1 à 16 |
| Note | 60 (C4) | 0 à 127, le nom de la note est affiché |
| Vélocité | 100 | 1 à 127 |
| Déclenchement | note courte | « Note courte » (durée fixe) ou « Maintenue pendant l'appui » |
| Durée | 150 ms | utilisé en mode note courte (10 ms à 10 s) |

Le titre de la touche affiche la note et le canal (`C4` / `1`), sauf si vous avez
saisi un titre personnalisé. Un appui répété renvoie proprement le note off avant
de rejouer la note, et un **note off est toujours envoyé** quand la touche disparaît
(changement de page, de profil, arrêt du plugin) : pas de note bloquée.

### Réglages — MIDI CC

| Réglage | Défaut | Détail |
| --- | --- | --- |
| Canal | 1 | 1 à 16 |
| Contrôleur | 1 (modulation) | 0 à 127 |
| Comportement | déclenchement | simple / bascule A-B / momentané |
| Valeur A | 127 | valeur envoyée à l'appui (ou 1er appui en bascule) |
| Valeur B | 0 | valeur envoyée au relâchement (momentané) ou au 2e appui (bascule) |

Le mode **momentané** est celui des boutons « sustain », « mute », « talkback » :
valeur A tant que le bouton est enfoncé, valeur B au relâchement.

### Réglages — MIDI CC Dial (Stream Deck +)

| Réglage | Défaut | Détail |
| --- | --- | --- |
| Canal | 1 | 1 à 16 |
| Contrôleur | 74 | 0 à 127 |
| Pas par cran | 1 | 1 à 64 : combien la valeur bouge par cran de molette |
| Valeur mini / maxi | 0 / 127 | plage de sortie (le CC est borné à cette plage) |
| Valeur initiale | 64 | valeur affichée au chargement de l'action |
| Appui sur le bouton | renvoyer la valeur | renvoyer la valeur, revenir à la valeur initiale, ou rien |
| Inverser | non | inverse le sens de rotation |

La valeur courante s'affiche sur l'écran du Stream Deck + avec une barre de
progression. L'appui (ou un tap sur l'écran) renvoie la valeur courante au DAW :
pratique quand le paramètre a bougé côté logiciel (mode « pickup » de certains DAW).

## Prérequis

- macOS 12 ou plus récent (Intel ou Apple Silicon)
- Stream Deck 6.9 ou plus récent (7.x recommandé ; le Stream Deck + est nécessaire
  pour l'action molette)
- Les **Xcode Command Line Tools**, une seule fois, pour compiler le petit
  programme CoreMIDI : `xcode-select --install`
- Node.js 20+ pour construire le plugin

## Installation

```bash
npm install
npm run setup
```

`npm run setup` enchaîne :

1. `npm run icons` — génère les icônes PNG du plugin
2. `npm run build` — compile TypeScript et bundle le plugin dans `bin/plugin.js`
3. `npm run native` — compile `native/MidiBridge.swift` en
   `com.rolltray.midideck.sdPlugin/bin/midi-bridge` (binaire universel arm64 + x86_64
   si la machine sait compiler les deux architectures)
4. `npm run install-plugin` — lie le dossier du plugin à Stream Deck
   (`streamdeck link`)

Le plugin apparaît alors dans la liste des actions, catégorie **MIDI Deck**.

### Vérifier que le port MIDI existe

- Ouvrez **Configuration Audio et MIDI** → menu **Fenêtre** → **Afficher le studio MIDI** :
  `Stream Deck MIDI` apparaît comme source (icône d'enceinte, côté « sources »).
- Ou directement dans votre DAW, dans les entrées MIDI.
- N'oubliez pas d'**activer le port en entrée** dans les préférences MIDI du DAW et,
  si besoin, d'activer « monitoring » / « remote » / « track » selon l'usage.

Le port existe tant que Stream Deck tourne (le plugin démarre au lancement de
l'application). Si vous lancez un DAW avant Stream Deck, le port apparaît dès que
Stream Deck démarre ; dans de rares cas un DAW doit être relancé pour rafraîchir
sa liste de ports.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| Aucun port `Stream Deck MIDI` | Vérifiez que `com.rolltray.midideck.sdPlugin/bin/midi-bridge` existe et est exécutable (`ls -l`) ; relancez `npm run native`. |
| Message `the CoreMIDI helper is missing` dans les logs | Le binaire n'a pas été compilé : `npm run native`. |
| `xcrun: error` / pas de `swiftc` | `xcode-select --install`, puis relancez `npm run native`. |
| Le plugin n'apparaît pas dans Stream Deck | `npm run restart`, ou quittez/relancez l'application Stream Deck. |
| Notes bloquées | Cliquez l'action une fois (le note off est renvoyé), ou relancez le plugin : le helper libère le port à sa fermeture. |

Les logs : lancez Stream Deck depuis un terminal pour voir stdout/stderr, ou
consultez le panneau de logs de l'application.

## Comment ça marche

```
Stream Deck (app)
   └── plugin Node.js            com.rolltray.midideck.sdPlugin/bin/plugin.js
          │  (ligne JSON sur stdin, ex. {"cmd":"cc","channel":1,"controller":74,"value":64})
          └── midi-bridge (Swift + CoreMIDI)
                 └── port virtuel « Stream Deck MIDI »  →  DAW
```

- Le plugin Node **lance** le helper en processus enfant et lui écrit une commande
  JSON par ligne. Si le helper meurt, il est relancé automatiquement (backoff 0,5 s → 10 s).
- Le helper crée la source virtuelle avec `MIDISourceCreate` et envoie les événements
  avec `MIDIReceived`. Il surveille aussi le serveur MIDI et recrée le port si
  `coreaudiod` redémarre.
- Pas de module natif Node (node-gyp) : le binaire Swift évite tout problème d'ABI
  avec le Node embarqué dans Stream Deck.

Commandes du helper : `noteOn`, `noteOff`, `cc`, `allNotesOff`, `panic`, `raw`, `quit`.

## Développement

```bash
npm run watch     # rebuild à chaque sauvegarde + restart du plugin
npm test          # vérification des types (tsc --noEmit)
npm run native    # recompiler le helper CoreMIDI
```

Fichiers :

- `src/plugin.ts` — point d'entrée, enregistrement des actions
- `src/actions/*.ts` — les trois actions
- `src/midi/bridge.ts` — lancement du helper, file d'attente, reconnexion
- `src/settings.ts` — réglages et valeurs par défaut
- `native/MidiBridge.swift` — helper CoreMIDI
- `com.rolltray.midideck.sdPlugin/` — le bundle installé par Stream Deck
  (manifest, `bin/plugin.js`, icônes, Property Inspectors, layout de la molette)

## Distribution

```bash
npm run package   # produit com.rolltray.midideck.streamDeckPlugin
```

Le fichier `.streamDeckPlugin` est une archive du dossier `.sdPlugin` : un double-clic
l'installe dans Stream Deck. Il doit contenir le binaire `bin/midi-bridge` compilé
pour la bonne architecture, donc **packagez depuis un Mac** (`npm run package` s'en
charge via `npm run native`).

## Limites connues

- **macOS uniquement** (CoreMIDI). Windows demanderait un équivalent
  (`winmm` / loopMIDI) dans un second temps.
- CC sur 7 bits (0-127) : pas de CC 14 bits ni de RPN/NRPN.
- Pas encore d'envoi de notes tenues avec « sustain », ni de messages SysEx.

> Note : le plugin a été validé par compilation/typage et validation du manifest
> hors macOS ; le helper Swift et le rendu sur le Stream Deck + doivent être testés
> sur un Mac (voir « Dépannage »).
