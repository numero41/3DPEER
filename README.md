# 3DPEER

Modele 3D -> un seul fichier .html : double-clic, piece jointe, offline,
rotation tactile. Le modele, son decompresseur et son viewer voyagent ensemble.

## Commandes

    npm install
    npm run pack -- modele.glb sortie.html --bits 12 --title "Mon modele"
    npm test

## Arborescence

    src/codec/     base85, conteneur 3DPEER, quantisation — ISOMORPHE (Node + navigateur).
                   Ces modules sont partages par le packer ET le viewer : une seule
                   source de verite pour le format. Le futur site drag-drop les
                   reutilisera tels quels cote client.
    src/pack/      cote Node : enveloppe gzip, modes geo/gltf, assemblage, auto-tests
    src/viewer/    cote navigateur : decode, scene commune, morphs, boots geo/gltf
    src/template/  page.html + page.css de l'artefact (placeholders {{...}},
                   substitution par split/join — jamais String.replace, le payload
                   contient des $)
    scripts/       CLI pack.mjs, regression test.mjs (fixtures procedurales, zero binaire)
    docs/          descriptif technique

## Modes

geo  — geometrie statique : flux 3DPEER custom, buffers GPU quantises tels quels
gltf — skins / morphs / animations / textures : GLB optimise (gltf-transform CLI)
       dans la meme enveloppe, GLTFLoader appaire three r160, sliders de morphs

Versions epinglees : meshoptimizer 0.20 (codec vertex v0) + three 0.160 —
paire encodeur/decodeur testee sur tout le parc navigateur depuis 2023.
Chaque HTML produit est auto-teste (re-extraction + decodage complet).
