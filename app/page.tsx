import {cookies} from 'next/headers';
import MetroApp from '@/components/MetroApp';
import Login from '@/components/Login';
import {SESSION_COOKIE,configuredPassword,validSession} from '@/lib/auth';
export const dynamic='force-dynamic';
export default async function Page(){
 const token=(await cookies()).get(SESSION_COOKIE)?.value;
 return await validSession(token,configuredPassword())?<MetroApp/>:<Login/>;
}
