# CLAUDE.md — 3dpeer

Projet : packer « modèle 3D → fichier .html autonome ». Un GLB entre, un
fichier unique sort ; il s'ouvre par double-clic, en pièce jointe, offline.
La roadmap phasée est dans ROADMAP.md. Ce fichier liste les invariants —
chacun encode un bug réel ou une décision produit. Ne pas les casser.

## Commandes

    npm run pack -- entree.glb sortie.html [--bits 12] [--title "..."] [--texsize 2048]
    npm test                # régression : fixtures procédurales, échoue si un auto-test casse
    npm run build:site      # bundle le workbench + assets d'export
    npm run dev             # sert site/ sur http://localhost:8137

## Invariants absolus

1. **L'artefact est autonome.** Zéro requête réseau dans le HTML exporté :
   pas de fetch, pas de CDN, pas d'asset externe. Tout est inliné. Il doit
   fonctionner en file://, en pièce jointe mail, dans dix ans.

2. **Paires codec épinglées.** meshoptimizer 0.20.0 (codec vertex v0) +
   three 0.160.0, encodeur et décodeur du MÊME paquet. Historique : un
   encodeur 1.2.0 (codec v1) a produit « malformed buffer data » sur mobile
   alors que le test Node passait. Toute montée de version se fait des deux
   côtés à la fois, avec re-test pièce jointe sur mobile réel.

3. **L'auto-test porte sur le HTML produit**, jamais seulement sur les
   intermédiaires : ré-extraction du payload depuis le fichier final +
   décodage complet avec le décodeur three r160 (le plus conservateur du
   parc). Toute feature qui touche l'artefact ajoute son auto-test.

4. **Placeholders par split/join, jamais String.replace.** Le payload base85
   contient `$` — `.replace` corromprait via les motifs `$&`/`$$`.
   Voir put() dans src/pack/assemble.js et src/app/main.js.

5. **Base85, pas base64.** Alphabet custom dans src/codec/base85.js : ni `"`,
   ni `\`, ni `<` — la séquence `</script` est impossible par construction,
   et le surcoût est +25 % au lieu de +33 %. Ne pas réintroduire base64.

6. **Zéro CSS dans le HTML ou le JS.** Styles du site dans site/site.css,
   styles de l'artefact dans src/template/page.css. Les états passent par
   des classes. Aucun attribut style, aucun element.style, aucun <style>
   généré en JS. (Exigence explicite de David.)

7. **Le format conteneur a une source unique** : src/codec/container.js.
   Magic 0x33445001 (« 3DP » + version), header 80 octets. Toute évolution
   du layout ⇒ incrément de version dans le magic + parse rétrocompatible.
   Packer et viewer importent ce module — jamais d'offsets recopiés à la main.

8. **src/codec/ reste isomorphe** (Node + navigateur, zéro dépendance) :
   c'est ce qui permet au site de partager le format avec le CLI. Rien de
   Node (Buffer, fs, zlib) dans ce dossier. gzip : zlib côté pack,
   CompressionStream/DecompressionStream côté navigateur.

9. **Jamais de fixtures binaires en repo.** Les tests génèrent leurs GLB
   procéduralement (scripts/test.mjs). Les gros fichiers de David servent
   aux essais locaux, pas au versionnement.

10. **La géométrie de l'utilisateur est sacrée.** Simplification débrayée
    par défaut (--simplify false partout) ; la décimation est un curseur
    opt-in, jamais un défaut silencieux.

## Décisions produit à respecter

- Un fichier → un artefact. Pas de galerie multi-fichiers en v1.
- « Rien ne quitte ce navigateur » est une promesse d'architecture : le site
  ne doit acquérir aucun endpoint d'upload.
- La « protection » (obfuscation, watermark, expiration) est de la dissuasion
  graduée, documentée comme telle — jamais vendue comme du DRM.
- .ma/.mb : refus définitif du parsing ; la réponse est le shelf Maya
  « Send to 3DPEER » (export GLB + ouverture du site).
- trimesh/Python : non. La décimation passe par le simplifier meshopt déjà
  en dépendance.
- Footer « made with 3dpeer » dans les artefacts gratuits ; son retrait est
  la première feature payante.

## Esthétique

Site : papier #fbfaf8, encre #171512, accent terracotta #d98b52, mono
typewriter, bordures 1px, zéro gradient marketing. Artefact : fond sombre
#211a14, légende ambre #c9a978. Deux registres, un seul fil (l'accent).

## Pièges connus

- file:// bloque fetch : l'artefact n'en fait aucun ; le SITE en fait
  (assets d'export) → toujours tester le site via npm run dev, pas en file://.
- Workers en file:// : via Blob URL uniquement, si un jour nécessaire.
- L'overlay wire+shaded ne suit pas les SkinnedMesh (v0 assumé).
- iOS < 16.4 n'a pas DecompressionStream : l'artefact affiche une erreur
  propre dans #hint — comportement voulu, pas un bug à « corriger » par un
  polyfill lourd.
