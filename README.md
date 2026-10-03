# Free Tennis (remake local + 2 joueurs)

Remake fidèle **non officiel** de « TENNIS GAME » (GAMEDESIGN), le jeu de freetennis.org. Projet de fan, sans lien avec GAMEDESIGN. La logique est portée ligne à ligne depuis l'ActionScript d'origine (voir `SPEC.md`).

**Installation** : Python 3.8+ suffit, sans aucun paquet à installer. **Solo** : `./run.sh` (Linux/macOS) ou double-clic sur `run.bat` (Windows). Le navigateur s'ouvre sur http://localhost:8000.
Choisissez EXHIBITION ou TOURNAMENT.

**Contrôles** : flèches pour se déplacer, et au moment de la frappe pour viser. Espace pour frapper / servir / valider.
M coupe le son, Échap revient au menu. Souris : menus, barres de stats, choix de la joueuse.

**Multijoueur (2 machines)** :
1. Les deux joueurs lancent le jeu et cliquent sur **2 PLAYERS**.
2. L'hôte clique sur **HÉBERGER**. Son IP:port s'affiche (aussi dans le terminal).
3. L'autre clique sur **REJOINDRE**, tape l'IP:port de l'hôte puis OK. Il peut aussi ouvrir `http://IP_HÔTE:8000` dans un navigateur, sans rien installer.
4. Le jeu marche en LAN sans configuration. Autorisez Python dans le pare-feu si le système le demande.
   Pas sur le même réseau (ou Wi-Fi d'école qui isole les machines) : installez Tailscale sur les deux PC, connectés au même compte
   ou avec la machine partagée, puis utilisez l'IP marquée (Tailscale). Autre solution : rediriger le port TCP 8000 de la box vers l'hôte.
   Autre port : `./run.sh --port 8001`.

L'hôte fait tourner la simulation autoritaire. L'invité envoie ses touches et reçoit 30 états par seconde, qu'il interpole avec prédiction de son propre déplacement.
Le ping s'affiche en haut à gauche. Si un joueur se déconnecte, la partie se met en pause et reprend à sa reconnexion. En fin de match, Espace lance la revanche.

**Tests** (Node 20+) : `node tests/logic_test.js` (déterminisme, matchs complets) et
`node --experimental-websocket tests/net_test.js` (hôte + client réels sur localhost, cohérence des états).
**Exécutable autonome** : `pip install pyinstaller` puis `pyinstaller --onefile --add-data "web:web" --name FreeTennis tennis.py`
(sous Windows avec PyInstaller < 6 : `"web;web"`).

**Fichiers** : `tennis.py` (serveur HTTP + relais WebSocket), `web/game.js` (logique pure), `web/net.js`, `web/render.js`, `web/audio.js`, `web/main.js`.
**Origine des assets** : aucun fichier du site original n'est redistribué. Graphismes dessinés en canvas, sons et musiques synthétisés en WebAudio, tout est fait main.
Seules les règles, les constantes, les noms des joueuses et les textes viennent de l'analyse du jeu d'origine (© GAMEDESIGN).
