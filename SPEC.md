# SPEC — Analyse de freetennis.org

## 1. Technologie de l'original

- `https://freetennis.org/` est une page qui charge **`tennis-game.swf`** (Flash, SWF v7, compressé zlib)
  dans l'émulateur **Ruffle** (WASM). Le jeu est « TENNIS GAME » de **GAMEDESIGN** (gamedesign.jp).
- Scène **600 × 600** px, **30 images/s**. Le code est de l'**ActionScript 2 (AVM1)**.
- Méthode : téléchargement du SWF, puis décompilation du bytecode AVM1 avec un petit décompilateur
  maison (Python, outillage temporaire non livré). Toutes les constantes et fonctions ci-dessous
  viennent du code source. J'ai aussi lancé le SWF dans Ruffle (Playwright) pour faire des captures
  qui servent de référence visuelle (couleurs, positions).
- La logique tourne dans un seul `onEnterFrame` à 30 Hz : `user_action(); move_enemy(); move_ball();`.
  Il n'y a pas de delta-time : **un tick = 1/30 s**, et toutes les vitesses s'expriment en unités par tick.

## 2. Repère, projection, rendu

- Repère du terrain : `vx` en latéral (0 au centre), `vy` en profondeur (0 au filet, `+` côté joueur
  humain en bas, `-` côté adversaire), `vh` pour la hauteur de la balle.
- `COURT_W=180` (demi-largeur simple), `COURT_H=360` (demi-longueur), `SERVE_H=200` (ligne de service),
  `NET_H=40`, `SCREEN_OX=300`, `SCREEN_OY=300`.
- Projection en pseudo-3D :
  `per = 1 + vy/COURT_H/10` ; `x = 300 + vx*per` ; `y = 300 + vy/2 - vh*per`.
  Joueurs à l'échelle `60*per` %, balle à `100*per` %, ombres posées au sol (`vh=0`).
- Terrain dessiné (mesuré sur capture) : double à ±230, simple à ±180, lignes de service à ±200,
  ligne médiane de service, marques centrales sur les lignes de fond. Filet entre les poteaux à x≈103..497
  (écran), bande blanche en haut, filet noir à 50 %. Herbe `#6cac00` avec des bandes plus sombres en
  perspective. Ombres noires à 50 % d'opacité.
- Ordre d'affichage fixe (profondeurs Flash) : terrain < ombres < joueur du fond (COM) < filet <
  marque de rebond < ombre de la balle < balle < joueur du bas < messages. La balle passe donc
  toujours devant le filet et devant le joueur du fond.
- Interface : score `score_txt` en bas à gauche (« YOU 15 - 0 COM », serveur en premier), bouton ◀ en
  haut à droite (quitter vers le titre), messages centrés (FAULT, OUT, 15 - 0, DEUCE, ...).

## 3. Contrôles (code `check_pad`)

- **Flèches** : déplacement (`pad_hori`, `pad_vart` valant -1, 0 ou 1). **Espace** : frapper / servir.
- L'état des touches est échantillonné **une fois par tick** (`keydata[]` mis à jour par keyDown/keyUp).
- Au moment de la frappe, la flèche maintenue choisit la zone visée : grille 3×3 (gauche/centre/droite
  × long/milieu/court), avec un point aléatoire dans la case.
- Souris : menus, réglage des barres (Exhibition), choix du joueur (Tournament).

## 4. Joueurs

- Stats (0..9) : `forehand=20+d0`, `backhand=20+0.5*d1`, `serve=30+3*d2` (vitesses de balle max),
  `footwork=6+0.3*d3` (vitesse de déplacement par tick), `netplay=d4`, `tech=d5` (IA).
- États : `PS_WAIT=1, PS_STROKE=3, PS_SERVE=4, PS_TOSS=5, PS_FREEZE=6, PS_AFTER=7`.
- Déplacement humain (en WAIT uniquement) : `vx += hori*footwork`, `vy += vart*footwork`, `vy ≥ 20`
  (on ne passe pas le filet). Pas d'autre borne.
- Frappe (`start_stroke`) : smash si `vh>70` et si la balle est dans [-30, 50] en x, revers si la balle
  (dans 3 ticks) est à gauche, coup droit sinon. Zones de frappe en x : coup droit [-10, 60], revers
  [-60, 10], smash [-30, 50] ; en profondeur [-120, 80] ; en hauteur `vh ≤ 120`
  (en miroir pour le joueur du fond).
- Contact testé **uniquement au tick 3** de l'animation (`cnt==3`). Retour en attente (`start_wait`) à
  l'image 21 de l'animation (coup droit/revers) ou 17 (smash), soit 20 ou 16 ticks. Après un smash,
  le joueur avance de 20 vers le filet.
- Service : position `serve_pos*20` (±1 en alternance à chaque point), relanceur à `∓120`, profondeur
  ±380. Joueur : Espace → lancer (`toss`), la balle est lancée au tick 7 (`vh=50`, `up=10`), puis
  Espace possible dès le tick 9. COM : lancer après 10 ticks, frappe au tick 23.
- Animations (images) : wait 1, course gauche/droite 13 en boucle, coup droit/revers 21, smash 17,
  serve 1, toss 10 (arrêt à 8), win, lose.

## 5. Balle (code `start_move_ball`, `check_hit_net`, `move_ball`)

- `GRAVITY=0.8` par tick. Chaque frappe vise un point (dx, dy). On essaie les vitesses
  `max, max-4, ..., max-16` et on garde la première qui passe au-dessus de `NET_H+10` (simulation
  complète de la trajectoire). Durée `n = dist/speed` ticks ; `ax, ay = delta/n` ;
  `up = (n(n-1)G/2 - vh)/n` ⇒ la balle retombe exactement au point visé.
- Intégration par tick : `vh += up - down` ; si `vh<0`, rebond : `up = (down-up)*2/3`
  (arrêt si < 1.3), `vh=0`, `ax, ay *= 3/5`. Sinon `down += G`. Puis `vx += ax`, `vy += ay`.
- **Pas de collision réelle avec le filet** : la vitesse est seulement réduite pour le franchir.
- Marque de rebond : alpha 100 → 0 en 10 ticks. Son « Hit » à chaque frappe, « Bound » à chaque rebond.

## 6. Règles et score

- 1er rebond du service hors du carré visé (diagonale selon `server`/`serve_pos`, bornes strictes) :
  **FAULT** ; deuxième faute : **DOUBLE FAULT** (point au relanceur). Un lancer non frappé tombe derrière
  le serveur, ce qui compte comme une faute.
- Volée sur le retour de service (relanceur frappe avant le rebond quand `rally_cnt==1`) : point au serveur.
- En jeu : 1er rebond hors du simple (côté adverse) : **OUT**, point à l'autre. 2e rebond : point
  au dernier frappeur (`MISS`). Pas de let, pas de faute de filet.
- Points 0/15/30/40, **DEUCE**, **Advantage NOM**, « Game won by NOM ».
- Match : **premier à 3 jeux avec 2 jeux d'écart** (« Getting 3 games first to win »). Pas de sets,
  pas de tie-break, **pas de changement de côté**. Le service alterne à chaque jeu.
- Délais : message FAULT/OUT pendant 30 ticks, score pendant 30 ticks, fin de jeu et fin de match
  attendent Espace (bouton « Space bar » animé pendant 12 ticks).

## 7. IA (code `move_enemy`, `set_ball_dest_com`, `start_wait`)

- Après sa frappe : retour vers (0, -360), ou montée au filet (`dest=(ball.dx/3, -150)`) si
  `netplay > rand*20` (tiré une fois par point).
- Quand le joueur frappe : COM figé 10 ticks (FREEZE), puis il vise l'interception
  (sur la trajectoire s'il est devant le rebond, sinon au point de rebond + 5 ticks de glissement).
- Déplacement de `footwork`/tick par axe, avec une tolérance de ±10. Il frappe quand la balle sera
  devant lui dans 4 ticks et à moins de 60 en x.
- Visée : case 3×3 aléatoire ; si `tech > rand*10`, il vise le côté opposé au joueur ; au filet, il joue
  long ou milieu.

## 8. Écrans et modes

- **Titre** : « TENNIS GAME », aide (« Space key to hit the ball. Arrow key to move or to aim the ball
  direction at the moment of stroke. Getting 3 games first to win. »), menu EXHIBITION / TOURNAMENT /
  TOP PAGE, logo GAMEDESIGN.
- **Exhibition** : stats aléatoires `floor((r+r+r)*10/3)` pour YOU et COM (Forehand, Backhand, Serve,
  Footwork). Barres modifiables à la souris (valeur affichée = stat+1). « Space bar » pour lancer.
  netplay/tech restent ceux de `player_data` (par défaut COM : netplay 5).
- **Tournament** : 16 joueuses (`tdat` = 6 chiffres + nom, ex. `787765SELES`). Survol : barres.
  Clic : la joueuse choisie passe en position 0 et les 15 autres sont mélangées. Tableau à 4 tours
  (1st MATCH, 2nd MATCH, SEMI FINAL, FINAL MATCH) ; l'adversaire du tour k est choisi parmi les
  `tdat[2^k .. 2^(k+1)-1]` (somme des stats hors netplay + rand*20). Une défaite renvoie au titre ;
  4 victoires mènent à l'écran de fin (Congratulations, résultats qui défilent, crédits). Applaudissements
  sur chaque point gagné sur double rebond et en fin de match (tournoi uniquement).
- **Sons** : Hit, Bound, app (applaudissements), app2 (ovation), clic du bouton Espace, musique du titre
  et jingle « start » (écrans de stats et de tableau). Pas de musique pendant le jeu.

## 9. Hypothèses et choix (non déterminables avec certitude ou adaptés)

1. **Ordre intra-tick** : avance des animations (qui déclenche `start_wait`), puis
   `user_action/move_enemy/move_ball`, puis compteurs des messages. Erreur possible de ±1 tick par
   rapport à l'ordre exact du lecteur Flash.
2. **Graphismes** : sprites, terrain et décors redessinés en canvas (formes vectorielles simples), sans
   reprendre les dessins de l'original. Les poses suivent les étiquettes et durées d'animation d'origine.
3. **Sons et musiques** : synthétisés (WebAudio), pas les fichiers d'origine.
4. **Textes des écrans win/lose** : leur contenu graphique n'a pas été extrait. J'affiche « YOU WIN! »
   ou « YOU LOSE... » avec le score en jeux.
5. **TOP PAGE** (lien externe) remplacé par **2 PLAYERS** (réseau).
6. **Appui court sur Espace** : un appui plus bref qu'un tick, qui serait perdu dans l'original, est
   retenu jusqu'au tick suivant. Le comportement en maintien reste identique.
7. **Aléatoire** : `Math.random` remplacé par un générateur à graine (mulberry32), pour que la logique
   soit déterministe.
8. **Mode 2 joueurs (en ligne)** : le créateur de la partie est le joueur du bas (P1) et l'autre celui du fond (P2), vu de son côté
   (vue retournée). L'invité joue avec les règles « humaines » en miroir. Les comportements propres à l'IA
   (FREEZE, pose « win » quand la balle l'a dépassé) ne s'appliquent qu'à COM. Stats équilibrées (5) pour
   les deux joueurs. Mode exhibition (pas d'applaudissements). Revanche avec Espace. Le serveur simule le match ;
   partie rapide (appariement) ou partie privée rejointe par code de 4 caractères ou lien `#CODE`.
9. **Rendu** : la simulation reste à 30 Hz fixe. L'affichage suit requestAnimationFrame et interpole les
   positions entre deux ticks (affichage plus fluide, timings identiques).

## 10. Revue de fidélité (jeu livré comparé à cette spec)

| Point | État |
|---|---|
| Constantes, projection, physique balle, franchissement du filet | Identiques (portage ligne à ligne de `move_ball`, `start_move_ball`, `check_hit_net`) |
| Contrôles, zones et fenêtre de frappe (tick 3), durées d'animation 21/17/10 | Identiques |
| IA (FREEZE, interception, montée au filet, `tech`) | Identique |
| Score, deuce/avantage, fautes, volée sur retour, 3 jeux à 2 d'écart | Identique ; délais de 30 ticks et bouton Espace de 12 ticks |
| Exhibition (stats aléatoires, barres éditables), tournoi (16 joueuses, tableau, choix des adversaires, fin) | Identiques ; écran de fin simplifié (mêmes étapes, mise en page différente) |
| Graphismes, sons, musiques | **Recréés** : même cadrage, mêmes couleurs et positions, mais dessins et sons différents |
| Écart ±1 tick possible | Ordre intra-tick du lecteur Flash supposé (§9.1) |
| Appui sur Espace plus court qu'un tick | Retenu au lieu d'être perdu (§9.6) |
| TOP PAGE | Remplacé par 2 PLAYERS |
| Mode 2 joueurs | Ajout (absent de l'original) ; règles « humaines » en miroir pour P2 (§9.8) |
