# Shop Santé — Réappro Metro

Application privée pour la **commande hebdomadaire de chaque Metro**.

1. **Ventes** : importez les rapports « Ventes Shop Santé » que Metro envoie chaque jeudi (`ZRT_ZMPOSJ21_SHOPSANTE_01_00000.CSV`). Vous pouvez en sélectionner plusieurs à la fois, toutes semaines et tous Metros confondus.
   - Le format est reconnu tel quel : UTF-16, « ; », en-tête sur deux lignes.
   - Le Metro est reconnu par son code client : 22658 Innovation, 22531 St-Augustin, 22636 St-Nicolas, 22992 Ste-Foy.
   - Les semaines sont circulaires, du jeudi au mercredi.
   - Une journée absente du rapport (jour férié, rapport extrait avant la fin de la journée) n’est pas un zéro : la semaine est ramenée à 7 jours.
   - Les semaines d’ouverture d’un Metro (moins de la moitié de sa semaine médiane) sont écartées.
   - Tout autre fichier avec une ligne par Metro, produit et date est aussi accepté, ses colonnes étant reconnues par leur nom.
   - Chaque fichier remplace les semaines qu’il couvre. Les 26 dernières semaines sont conservées.
2. **Règle** : celle de l’outil de réappro de Vanier, ajustée aux ventes des Metros (quelques unités par produit et par semaine) :
   - rythme : moyenne des 4 dernières semaines et de toutes les semaines ;
   - tendance ±15 %, seulement à partir de 12 unités vendues ;
   - sans stock connu : on remplace ce qui s’est vendu, arrondi à la caisse la plus proche ;
   - avec stock connu : couverture + délai × sécurité − stock, arrondi à la caisse supérieure.

   Rétro-test sur trois semaines de 2026 : la règle de Vanier commandait 39 % de plus que les ventes ; la règle ajustée tombe à environ 0 %.
3. **Jev** (TypeSafe, via Netlify AI Gateway) : pour chaque ligne, il choisit entre *rien*, *une caisse de moins*, *la règle* et *une caisse de plus*, et donne la probabilité de chaque option. Une confiance sous 60 % marque la ligne « à vérifier ». Si Jev ne répond pas, la règle s’applique.
4. **Validation** : les quantités sont modifiables. La commande est enregistrée par semaine et se télécharge en CSV, un fichier par Metro.

Ne jamais ajouter au dépôt de données de ventes réelles, de jeton ou de mot de passe.

## Hébergement Netlify

- **Construction** : Next.js (`netlify.toml`), Node 22.
- **Base de données** : Netlify Database (PostgreSQL), créée par le paquet `@netlify/database`. Les migrations sont dans `netlify/database/migrations/`.
- **Connexion** : un seul propriétaire, avec la variable secrète `APP_PASSWORD` (12 caractères minimum). Le cookie de session est signé avec une clé dérivée du mot de passe.
- **Jev** : il faut activer l’AI Gateway sur le site. Netlify fournit les accès aux fonctions, sans clé à saisir; les appels sont facturés en crédits Netlify. Les requêtes partent de `app/api/metro/route.js`, par lots de 20 lignes.

## Développement

```bash
npm ci
npm test            # lecture des fichiers, règle, Jev simulé, connexion — PostgreSQL en mémoire (PGlite)
npm run typecheck
npm run build
```

Les données des tests sont fictives.
