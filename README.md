# Free Tennis (remake, solo + 2 joueurs en ligne)

Remake fidèle **non officiel** de « TENNIS GAME » (GAMEDESIGN), le jeu de freetennis.org. Projet de fan, sans lien avec GAMEDESIGN. La logique est portée ligne à ligne depuis l'ActionScript d'origine (voir `SPEC.md`).

**Jouer** : https://tennis.tandor.fr. Rien à installer, il suffit d'un navigateur.
- **Partie rapide** (classée) : vous affrontez le prochain joueur qui cherche aussi une partie. Personne au bout de 5 s : un adversaire géré par le serveur (IA du jeu) prend la place.
- **Tournament** : seul contre 15 joueuses de l'original, avec vos propres capacités.
- **Héberger / Rejoindre** : partie amicale avec un code de 4 lettres ou un lien (`tennis.tandor.fr/#CODE`).
- **Classement** : top 20 à l'Elo.

**Progression** (`web/progression.js`) : tout le monde commence à 3 en coup droit, revers, service et déplacement. Une partie rapide rapporte
100 XP (victoire) ou 40 XP (défaite) ; chaque niveau donne un point de capacité (max 9), réattribuable à volonté. Elo de départ 1000, K = 32.
Quitter une partie rapide en cours compte comme une défaite. Les invités restent à 3 et ne sont pas classés.

**Compte** (bouton en haut à droite de l'accueil) : connexion avec Google, niveau, Elo, capacités, pseudo unique, couleur de tenue et de cheveux.
Sans compte, on joue en invité. Les tenues viennent de `web/cosmetics.js`, catalogue partagé client/serveur prévu pour accueillir de futurs cosmétiques.

**Contrôles** : flèches pour se déplacer, et au moment de la frappe pour viser. Espace pour frapper / servir / valider.
M coupe le son, Échap revient au menu. Souris : menus, barres de stats, choix de la joueuse.

**Réseau** : le serveur (`server/server.js`, Node sans dépendance) fait tourner chaque match de façon autoritaire à 30 Hz.
Chaque joueur envoie une entrée par tick, et le serveur les applique dans l'ordre. Le navigateur rejoue ses entrées pas encore confirmées
par-dessus chaque état reçu (prédiction avec rollback) : son joueur, ses frappes et la balle réagissent sans attendre le réseau.
L'adversaire est extrapolé puis corrigé. Le ping s'affiche en haut à gauche. Après une coupure, la partie se met en pause et
reprend automatiquement (60 s pour revenir, recharger la page suffit). En fin de match, Espace lance la revanche.

**En local** (Node 22.13+) : `node server/server.js` puis http://localhost:8780 (`--port`, `--host`, `--db`, `--google-client-id`).
**Tests** : `node tests/logic_test.js` (déterminisme), `node tests/net_test.js` (serveur + clients WebSocket réels, bot) et `node tests/account_test.js` (connexion Google simulée, profils).

**Hébergement** (Raspberry Pi) : deux services systemd *utilisateur* dans `deploy/`, le serveur sur 127.0.0.1:8780 et un tunnel
Cloudflare dédié (`cloudflared tunnel create tennis`, `cloudflared tunnel route dns tennis tennis.tandor.fr`, puis `deploy/cloudflared.yml`
d'après `deploy/cloudflared.example.yml`). Aucun port ouvert sur la box. Mise à jour : `deploy/update.sh`.
Google : créer un « ID client OAuth » de type *Application Web* (origine `https://tennis.tandor.fr`) et le mettre dans `~/tennis-data/env` (`GOOGLE_CLIENT_ID=...`).

**Fichiers** : `server/server.js` (HTTP + WebSocket + salles), `server/db.js` (comptes SQLite), `server/auth.js` (jeton Google), `server/bots.js`, `web/account.js`, `web/cosmetics.js`, `web/progression.js`, `web/game.js` (logique pure, partagée client/serveur), `web/net.js`, `web/render.js`, `web/audio.js`, `web/main.js`.
**Origine des assets** : aucun fichier du site original n'est redistribué. Graphismes dessinés en canvas, sons et musiques synthétisés en WebAudio, tout est fait main.
Seules les règles, les constantes, les noms des joueuses et les textes viennent de l'analyse du jeu d'origine (© GAMEDESIGN).
