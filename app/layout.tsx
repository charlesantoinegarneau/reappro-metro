import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Shop Santé — Réappro Metro',description:'Commandes hebdomadaires des Metros : la règle propose, Jev choisit.',robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="fr-CA"><body>{children}</body></html>}
