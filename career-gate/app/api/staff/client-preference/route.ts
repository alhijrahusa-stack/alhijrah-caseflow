import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { staffGuard } from "@/lib/staff-api";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { AMAZON_LOCATIONS, SHIFT_TYPES, DAY_PATTERNS, SHIFT_DEFAULT_HOURS } from "@/lib/location-shift-options";

export const runtime = "nodejs";
const inputSchema=z.object({
 client_id:z.uuid(), location:z.number().int().min(0).max(AMAZON_LOCATIONS.length-1),
 shift:z.enum(SHIFT_TYPES.map(x=>x[0]) as [typeof SHIFT_TYPES[number][0], ...typeof SHIFT_TYPES[number][0][]]),
 days:z.enum(DAY_PATTERNS.map(x=>x[0]) as [typeof DAY_PATTERNS[number][0], ...typeof DAY_PATTERNS[number][0][]]),
 hours:z.string().trim().min(4).max(100),
});
export async function POST(req:Request){
 const traceId=traceIdFrom(req);
 const guard=await staffGuard(req,traceId,{mutation:true});
 if(guard.response)return guard.response;
 const parsed=inputSchema.safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return err("invalid_input","Choose a valid location, shift, days and hours",400,traceId);
 const {client_id,location,shift,days,hours}=parsed.data;
 const compatibleHours=[SHIFT_DEFAULT_HOURS[shift],...(shift==="front_half"||shift==="back_half"?["06:30 PM – 05:00 AM"]:[]),...(shift==="morning"||shift==="mid"?["08:00 AM – 04:30 PM"]:[]),...(shift==="night"?["10:00 PM – 06:30 AM"]:[])];
 if(!compatibleHours.includes(hours))return err("invalid_shift_hours","Hours do not match the selected shift",400,traceId);
 const [siteName,siteAddress]=AMAZON_LOCATIONS[location];
 const shiftName=SHIFT_TYPES.find(x=>x[0]===shift)![1];
 const dayName=DAY_PATTERNS.find(x=>x[0]===days)![1];
 const siteCode="MI_LOC_"+String(location+1).padStart(2,"0");
 try{
  const data=await withStaff(guard.session,async tx=>{
   const [client]=await tx`select id from clients where id=${client_id} and deleted_at is null and current_status not in ('completed','cancelled') for update`;
   if(!client)throw new Error("CLIENT_NOT_ACCESSIBLE");
   const [previous]=await tx`select * from client_preferences where client_id=${client_id} and rank='primary' order by preference_order,id limit 1 for update`;
   if(previous){
     await tx`update client_preferences set site_code=${siteCode},site_name=${siteName},site_address=${siteAddress},
       city=${siteName.split(" (")[0]},shift_code=${shift},shift_name=${shiftName},days=${dayName},hours=${hours}
       where id=${previous.id}`;
   }else{
     await tx`insert into client_preferences(client_id,rank,preference_order,city,site_code,site_name,site_address,job_id,job_title,shift_code,shift_name,days,hours,catalog_source)
       values(${client_id},'primary',1,${siteName.split(" (")[0]},${siteCode},${siteName},${siteAddress},'PREFERENCE','Amazon Associate',${shift},${shiftName},${dayName},${hours},'staff_preference')`;
   }
   await tx`update clients set updated_at=now() where id=${client_id}`;
   await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
      values(${client_id},'location_shift_updated',${guard.session.staff.id},'client',${client_id},
      ${tx.json(previous?{site:previous.site_code,shift:previous.shift_code}:{} )},
      ${tx.json({site:siteCode,shift,days:dayName,hours})},${traceId})`;
   return {client_id,site_code:siteCode,site_name:siteName,shift_code:shift,shift_name:shiftName,days:dayName,hours};
  });
  return ok(data,200,traceId);
 }catch(e){
  const message=e instanceof Error?e.message:"SAVE_FAILED";
  if(message==="CLIENT_NOT_ACCESSIBLE")return err("not_found","Active client not accessible",404,traceId);
  return err("save_failed","Unable to save preference",409,traceId);
 }
}
