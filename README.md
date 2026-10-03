# Free Tennis (remake, solo + 2 joueurs en ligne)

Remake fidèle **non officiel** de « TENNIS GAME » (GAMEDESIGN), le jeu de freetennis.org. Projet de fan, sans lien avec GAMEDESIGN. La logique est portée ligne à ligne depuis l'ActionScript d'origine (voir `SPEC.md`).

**Jouer** : https://tennis.tandor.fr. Rien à installer, il suffit d'un navigateur.
Choisissez EXHIBITION ou TOURNAMENT pour jouer seul contre l'ordinateur, ou **2 PLAYERS** pour jouer en ligne :
- **Partie rapide** : vous affrontez le prochain joueur qui clique aussi sur Partie rapide.
- **Partie privée** : vous obtenez un code de 4 lettres et un lien (`tennis.tandor.fr/#CODE`) à envoyer à votre adversaire.

**Contrôles** : flèches pour se déplacer, et au moment de la frappe pour viser. Espace pour frapper / servir / valider.
M coupe le son, Échap revient au menu. Souris : menus, barres de stats, choix de la joueuse.

**Réseau** : le serveur (`server/server.js`, Node sans dépendance) fait tourner chaque match de façon autoritaire à 30 Hz.
Chaque joueur envoie une entrée par tick, et le serveur les applique dans l'ordre. Le navigateur rejoue ses entrées pas encore confirmées
par-dessus chaque état reçu (prédiction avec rollback) : son joueur, ses frappes et la balle réagissent sans attendre le réseau.
L'adversaire est extrapolé puis corrigé. Le ping s'affiche en haut à gauche. Après une coupure, la partie se met en pause et
reprend automatiquement (60 s pour revenir, recharger la page suffit). En fin de match, Espace lance la revanche.

**En local** (Node 18+) : `node server/server.js` puis http://localhost:8780 (`--port`, `--host`).
**Tests** (Node 22+) : `node tests/logic_test.js` (déterminisme, matchs complets) et `node tests/net_test.js` (serveur + 2 clients WebSocket réels).

**Hébergement** (Raspberry Pi) : deux services systemd *utilisateur* dans `deploy/`, le serveur sur 127.0.0.1:8780 et un tunnel
Cloudflare dédié (`cloudflared tunnel create tennis`, `cloudflared tunnel route dns tennis tennis.tandor.fr`, puis `deploy/cloudflared.yml`
d'après `deploy/cloudflared.example.yml`). Aucun port ouvert sur la box. Mise à jour : `deploy/update.sh`.

**Fichiers** : `server/server.js` (HTTP + WebSocket + salles), `web/game.js` (logique pure, partagée client/serveur), `web/net.js`, `web/render.js`, `web/audio.js`, `web/main.js`.
**Origine des assets** : aucun fichier du site original n'est redistribué. Graphismes dessinés en canvas, sons et musiques synthétisés en WebAudio, tout est fait main.
Seules les règles, les constantes, les noms des joueuses et les textes viennent de l'analyse du jeu d'origine (© GAMEDESIGN).
