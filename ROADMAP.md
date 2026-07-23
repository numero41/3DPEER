# 3dpeer — ROADMAP

Document de travail pour l'atelier (Claude Code). Chaque phase a un objectif,
des tâches et un critère « fait quand ». Ne pas ouvrir une phase avant que la
précédente passe son critère. Les invariants du projet sont dans CLAUDE.md —
les lire avant toute modification.

## Phase 0 — fondations (FAIT)

Deux modes de packing (geo : flux 3DPEER custom, buffers GPU quantisés ;
gltf : GLB optimisé, GLTFLoader appairé, sliders de morphs), enveloppe
gzip + base85, auto-test sur le HTML produit, site workbench v0 (drag-drop,
modes d'affichage, vues, snapshot, panneaux auto morphs/parts/anims, export
réel non optimisé). Références mesurées : cube 62,05 → 4,20 Mo (÷14,8),
avatar 6,52 → 1,10 Mo avec 212 morphs.

## Phase 1 — compression in-browser (le cœur du produit)

Objectif : l'export du site produit la même qualité que le CLI, sans que le
fichier quitte le navigateur.

- Porter le pipeline d'optimisation côté navigateur : prune/weld/resample/
  quantize via @gltf-transform (core + functions tournent en browser),
  encodeur meshopt 0.20 en WASM, simplify() via le simplifier meshopt.
- Supprimer l'execSync CLI du mode gltf : un seul chemin de code programmatique
  partagé Node/navigateur (src/pack devient isomorphe là où c'est possible).
- Textures côté navigateur : decode image → canvas → toBlob('image/webp', q)
  avec plafond de taille (sharp reste réservé au CLI).
- Câbler les curseurs : bits positions, bits normales, taille + qualité
  textures, tolérance de resample anim, ratio/erreur de décimation.
- UX : wipe avant/après en direct, poids estimé affiché en continu, champ
  « poids cible » (solveur simple qui descend les curseurs jusqu'au budget).

Fait quand : depuis le site, le cube 62 Mo sort à ≤ 5 Mo et l'avatar à
≤ 1,3 Mo, ouverture mobile < 3 s, auto-test viewer OK, aucun octet envoyé
sur le réseau (vérifiable dans l'onglet Network).

## Phase 2 — imports

Objectif : accepter ce que l'audience a réellement sur son disque.

- obj, stl, ply : loaders three → GLTFExporter → pipeline existant.
  (stl = impression 3D ; ply à couleurs de sommets = scans → mode geo.)
- fbx : FBXLoader (web, matériaux approximatifs assumés) ; FBX2glTF binaire
  côté CLI pour la fidélité.
- Shelf Maya « Send to 3DPEER » : script Python qui exporte la sélection en
  GLB et ouvre le site. C'est un canal d'acquisition, pas une feature.
- usdz en IMPORT : P2, ne pas ouvrir avant la phase 4 (TinyUSDZ/WASM, gros).

Fait quand : un stl et un ply de test passent drag-drop → export → mobile ;
un fbx simple (mesh + anim) passe avec un rendu défendable.

## Phase 3 — l'artefact enrichi + « ce qui ship »

Objectif : le dialogue d'export devient une checklist de capacités.

- Modules viewer optionnels dans l'artefact : contrôles d'animation, vues,
  snapshot, parts show/hide, modes wireframe/clay.
- Checklist d'export : chaque case = contrôle éditorial (ne pas exposer la
  topologie au client) et octets. v1 pragmatique : un bundle complet par mode
  + config JSON injectée qui active/désactive ; le tree-shaking par variante
  de bundle (économie réelle d'octets) attend un build côté serveur ou
  esbuild-wasm — P2, documenter le surcoût accepté en attendant.
- Presets « portfolio » / « revue client ».
- Footer discret « made with 3dpeer » dans l'artefact + flag interne pour le
  retirer (prépare le gating de la phase 4). Le footer est la boucle de
  distribution : chaque fichier livré est une démo.

Fait quand : deux exports du même modèle avec deux presets donnent deux
artefacts aux capacités différentes, vérifiées à l'ouverture.

## Phase 4 — exports multiples + tier NDA

- Export triple en un clic : .html (interaction), .usdz (USDZExporter de
  three, écosystème Apple), turntable vidéo (rendu offscreen N frames →
  MediaRecorder webm ; mp4 si muxeur léger).
- Watermark forensique : seed par destinataire dans les bits de poids faible
  de la quantisation + petit outil de lecture (identifier une fuite).
- Date d'expiration (dissuasion, documentée comme telle).
- Licence Lemon Squeezy : clé vérifiée en local (signature, zéro serveur),
  retrait du footer, déblocage watermark/expiration.

Fait quand : un achat test Lemon Squeezy délivre une clé qui déverrouille,
et un fichier marqué est identifiable par l'outil de lecture.

## Phase 5 — site public

- Pages : l'app EST la landing ; exemples embarqués (artefacts en iframe) ;
  pricing ; docs courtes ; mentions légales Number41.
- Déploiement Cloudflare Pages, domaine 3dpeer.com, aucun cookie tiers.

Fait quand : une personne extérieure passe de l'URL au fichier exporté sans
aide, et l'envoie par WhatsApp avec succès.

## Transverse (à maintenir à chaque phase)

- test.mjs enrichi à chaque feature (fixtures procédurales : anim, textures,
  multi-prims) — jamais de binaires en repo.
- Matrice d'appareils avant toute release : iOS Safari (pièce jointe Mail +
  Fichiers), Android Chrome, desktop file://.
- Budget : ouverture artefact < 3 s sur mobile moyen, viewer ≤ 650 Ko/mode.
