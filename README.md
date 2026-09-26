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
   - sans stock connu : on remplace ce qui s’est vendu, arrondi à l’unité ;
   - avec stock connu : couverture + délai × sécurité − stock.
   - Les quantités sont en **unités exactes**, sans arrondi à la caisse : on arrondit, ou pas, à la cueillette.

   Rétro-test sur trois semaines de 2026 : la règle de Vanier commandait 39 % de plus que les ventes ; la règle ajustée tombe à environ 0 %.
   - **Ruptures probables** : une semaine à zéro est écartée du rythme quand ce zéro était très improbable au rythme du produit (moins de 5 % de chances, à partir de 3 unités par semaine attendues). On parle de « BO » quand aucun Metro ne l’a vendu cette semaine-là (rupture chez le fournisseur), et de « rayon vide » quand seul ce Metro ne l’a pas vendu. Un BO la semaine dernière met la ligne « à vérifier ».
   - **Produits nouveaux** : les semaines d’avant la première vente dans le réseau ne comptent pas.
3. **Jev** (TypeSafe, via Netlify AI Gateway) : il reçoit pour chaque ligne les ventes, les ruptures probables, le rythme du même produit dans les autres Metros et le coût. Pour chaque ligne, il choisit entre *rien*, *un peu moins*, *la règle* et *un peu plus* (écart d’environ 15 %, au moins 1 unité), et donne la probabilité de chaque option. Une confiance sous 60 % marque la ligne « à vérifier ». Si Jev ne répond pas, la règle s’applique.
4. **Classement et recherche** : la liste est classée par Marque > Produit > Variante. La marque est déduite de la description Metro, ou vient du catalogue Shopify (Produits → Exporter, CSV) quand on l’importe : marque, produit, variante et coût unitaire (« Cost per item ») exacts, rapprochés par code-barres. Le coût donne la valeur de chaque commande et guide Jev : une caisse de trop coûte cher sur un produit cher et lent, alors qu’une rupture coûte plus qu’un surplus sur un produit peu cher qui se vend bien. La barre de recherche filtre par marque, produit ou code-barres. Elle propose aussi les produits vendus ailleurs dans le réseau mais jamais à ce Metro, qu’on peut ajouter à la main.
5. **Cueillette** : le mode « Cueillette » sert pendant la préparation, sur téléphone. On y coche les produits cueillis, on ajuste les quantités (− / +), on retire un produit ou on le remet. On y suit la progression (produits et unités cueillis) et on voit la quantité prévue quand elle a changé. Chaque changement est enregistré automatiquement. Le CSV ne contient que les lignes gardées.
6. **Validation** : les quantités sont modifiables. La commande est enregistrée par semaine et se télécharge en CSV, un fichier par Metro.

Ne jamais ajouter au dépôt de données de ventes réelles, de jeton ou de mot de passe.

## Hébergement Netlify

- **Construction** : Next.js (`netlify.toml`), Node 22.
- **Base de données** : Netlify Database (PostgreSQL), créée par le paquet `@netlify/database`. Les migrations sont dans `netlify/database/migrations/`.
- **Connexion** : un seul propriétaire, avec la variable secrète `APP_PASSWORD` (12 caractères minimum). Le cookie de session est signé avec une clé dérivée du mot de passe.
- **Shopify** (facultatif) : variable secrète `SHOPIFY_ADMIN_ACCESS_TOKEN`, le jeton de l’app personnalisée « Outil commandes CAG » (portées `read_products` et `read_inventory`). Le bouton « Lire le catalogue dans Shopify » lit toutes les variantes, par pages de 250 : marque, produit, variante, code-barres et coût unitaire. Lecture seule : l’app n’écrit rien dans Shopify. Sans jeton, l’export CSV des produits reste possible.
- **Jev** : il faut activer l’AI Gateway sur le site. Netlify fournit les accès aux fonctions, sans clé à saisir; les appels sont facturés en crédits Netlify. Les requêtes partent de `app/api/metro/route.js`, par lots de 20 lignes.

## Développement

```bash
npm ci
npm test            # lecture des fichiers, règle, Jev simulé, connexion — PostgreSQL en mémoire (PGlite)
npm run typecheck
npm run build
```

Les données des tests sont fictives.
