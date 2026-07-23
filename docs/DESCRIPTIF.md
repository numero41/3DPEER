# 3dpeer — descriptif technique
### Modèle 3D → fichier HTML autonome. v0.1, juillet 2026.

## Objet

Un packer en ligne de commande : un GLB entre, un fichier `.html` unique sort. Ce fichier s'ouvre par double-clic, en pièce jointe mail ou WhatsApp, hors ligne, sur mobile comme sur desktop. Rotation au doigt, pincer pour zoomer, auto-rotation au repos. Aucun serveur, aucun compte, aucune requête réseau : le modèle, son décompresseur et son viewer voyagent ensemble dans le fichier. Le destinataire n'installe rien — le seul runtime requis est le navigateur, déjà présent partout.

C'est le principe du zip auto-extractible appliqué à la 3D : l'archive contient son propre décompresseur, la présentation contient son propre moteur de rendu.

## Anatomie du fichier livré

Le HTML produit contient trois choses. Un squelette minimal (canvas plein écran, une légende qui s'estompe, fond `#211a14`). Un premier `<script>` portant le payload : le modèle compressé, encodé en base85 dans un littéral JS, précédé d'une légende. Un second `<script>` portant le viewer bundlé et minifié (~610 Ko) : three.js core, OrbitControls, RoomEnvironment et le décodeur meshopt 0.20 avec son WASM inliné.

## Pipeline de compression

Sept étages, avec les chiffres mesurés sur le fichier de référence (976 k sommets, 1,9 M de triangles, couleurs par sommet, sans texture) :

1. **Prune** (`keepAttributes:false`) — suppression des attributs orphelins. Sur le fichier de référence, 15 Mo de tangentes et 8 Mo d'UV qu'aucune texture ne référençait.
2. **Join + weld** — fusion des primitives compatibles, soudure des sommets équivalents.
3. **Quantisation maison** — positions sur 12 bits (paramétrable `--bits`) stockées en uint16 avec stride 8, normales en int8 stride 4, couleurs en uint8 RGBA stride 4. Erreur géométrique maximale mesurée : 0,007 % de la diagonale de la boîte englobante — invisible. La déquantisation ne coûte rien au chargement : elle est portée par la matrice de l'objet (voir plus bas).
4. **Réordonnancement** (`reorderMesh`) — réorganisation des sommets pour le cache GPU. Sert deux fois : meilleure compression des flux ET meilleur débit de rendu.
5. **Encodage meshopt, codec vertex v0** — `encodeVertexBuffer` / `encodeIndexBuffer`. Le choix de la v0 est délibéré : c'est celle que tous les décodeurs navigateur digèrent depuis 2023 (voir « leçons »).
6. **gzip -9** — les flux meshopt sont conçus pour être repassés dans un codeur d'entropie. Le décodage côté client est natif (`DecompressionStream`), donc gratuit : zéro octet de décompresseur à embarquer pour cet étage. Sur la référence : 8,3 Mo → 2,95 Mo.
7. **Base85 à alphabet propriétaire** — 85 symboles choisis pour être sûrs dans un littéral JS entre guillemets doubles : ni `"`, ni `\`, ni `<`, donc la séquence `</script` est impossible par construction. Surcoût +25 % contre +33 % pour le base64. Cadre `[longueur u32][gzip][padding %4]`.

Bilan sur la référence : **62,05 Mo → 4,24 Mo** (÷14,6), fichier complet viewer compris, en ~10 s de packing.

## Format conteneur 3DPEER, version 1

| Offset | Type | Contenu |
|---|---|---|
| 0 | u32 BE | magic `0x4E343101` (« 3DPEER » + version) |
| 4 | u32 LE | nombre de sommets |
| 8 | u32 LE | nombre d'indices |
| 12 | f32 ×3 | bbox min |
| 24 | f32 ×3 | bbox taille |
| 36 | f32 ×4 | baseColorFactor |
| 52 | f32 | metallic |
| 56 | f32 | roughness |
| 60 | u32 | bits de quantisation |
| 64 | u32 ×4 | longueurs des 4 flux : pos, nrm, col, idx |
| 80 | — | flux meshopt concaténés |

Il n'y a plus de GLB dans le fichier livré : rien de standard à extraire. Un conteneur binaire privé, dans un alphabet inconnu, derrière un gzip. C'est de la dissuasion graduée, pas du DRM — un attaquant déterminé instrumente WebGL — mais l'extraction triviale (« ouvrir les devtools, sauver le .glb ») n'existe plus.

## Hydratation GPU

Les flux décodés montent en l'état, sans conversion en float : positions `Uint16Array` via `InterleavedBuffer` (stride 4 éléments, non normalisé), normales `Int8Array` (normalisé), couleurs `Uint8Array` RGBA (normalisé), indices `Uint32Array`. La déquantisation des positions est faite par le vertex shader via la matrice de l'objet : `mesh.scale = taille_bbox / (2^bits − 1)` par axe, `mesh.position = bbox_min`. La normalMatrix de three (inverse-transposée) absorbe correctement l'échelle non uniforme pour l'éclairage. La bounding sphere est calculée en espace quantisé puis transformée par la matrice monde pour le culling. Résultat : environ moitié moins de VRAM qu'en float32, et un coût CPU de chargement quasi nul.

## Rendu

`MeshStandardMaterial` avec `vertexColors` multipliées par le `baseColorFactor` (sémantique glTF), metallic/roughness du matériau source. Éclairage image : PMREM généré à partir de `RoomEnvironment` — un studio procédural, donc zéro asset HDRI embarqué. Tone mapping ACES, sortie sRGB, pixelRatio plafonné à 2.

## Robustesse — leçons intégrées

**Paires codec appairées.** Premier incident de développement : encodeur meshoptimizer 1.2.0 (2026) émettant le codec vertex v1, illisible par les décodeurs embarqués dans le parc three ≤ 2024 → « malformed buffer data » sur mobile alors que l'auto-test Node passait (même lib des deux côtés). Résolution : tout le projet est épinglé sur meshoptimizer 0.20.0, codec v0, encodeur et décodeur du même paquet.

**L'auto-test porte sur l'artefact, pas sur les intermédiaires.** À chaque packing, l'outil ré-extrait la chaîne `__P` du HTML final produit, la décode intégralement (base85 → gzip → meshopt) avec le décodeur de **three r160** — délibérément le plus ancien et le plus conservateur du parc — et compare bit à bit avec les flux sources. Un fichier livré est un fichier dont le chemin de décodage complet a été exécuté.

**Compatibilité client.** `DecompressionStream` : Chrome/Edge 80+, Safari/iOS 16.4+, Firefox 113+. WebGL2 requis (three r160). En dessous, le fichier affiche une erreur propre dans la légende plutôt qu'un écran vide.

## Limites connues, v0

Une seule primitive packée (les suivantes sont ignorées avec avertissement). Pas de textures — le pipeline image (WebP/KTX2) est le prochain gros étage. Pas d'animations ni de skinning. Normales requises dans le GLB source. La « protection » est de la dissuasion, pas du chiffrement à clé.

## Feuille de route produit

Court terme : multi-primitives et multi-matériaux ; textures (recompression WebP, plafond de taille, décodage natif navigateur) ; animations (resample + compression meshopt des courbes, le viewer sait déjà les jouer). Produit : curseur de qualité avec comparaison avant/après en direct et poids affiché ; export triple en un clic (.html interactif, .usdz pour l'écosystème Apple, .mp4 turntable 9:16 pour les feeds) ; LOD progressif monofichier (silhouette affichée en ~300 ms pendant le décodage du plein) ; watermark forensique dans les bits de poids faible de la quantisation — chaque destinataire reçoit un fichier marqué différemment, identifiable en cas de fuite ; date d'expiration ; interface drag-drop pour non-codeurs ; licence Lemon Squeezy.

## Reproduction

```
npm install
node pack.mjs modele.glb sortie.html --bits 12 --title "Mon modèle"
```

Chiffres de référence (50playgrounds_cube_00) : GLB source 62,05 Mo → conteneur 3DPEER 8,34 Mo → gzip 2,95 Mo → base85 3,68 Mo → **HTML final 4,24 Mo**, auto-test three r160 : OK.
