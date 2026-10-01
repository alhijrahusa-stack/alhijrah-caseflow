"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function active(pathname:string,href:string){return href==="/staff"?pathname==="/staff":pathname===href||pathname.startsWith(`${href}/`)}

export function StaffNavigation({management}:{management:boolean}){
  const pathname=usePathname();
  const item=(label:string,href:string)=><Link key={href} className="staff-nav-link" data-executive-tactile="true" aria-current={active(pathname,href)?"page":undefined} href={href}>{label}</Link>;
  return <nav className="staff-nav-strip" aria-label="Career Gate operations">
    {item("Command Center","/staff")}
    {item("Clients","/staff/clients")}
    {item("My Work","/staff/workspace")}
    {management&&item("Accounts","/staff/accounting")}
    {management&&item("Admin","/staff/admin")}
    {item("Search","/staff/search")}
  </nav>;
}
