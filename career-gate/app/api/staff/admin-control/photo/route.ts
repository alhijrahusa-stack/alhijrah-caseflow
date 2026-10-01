import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { permissionFor } from "@/lib/authz";
import { DOC_MAX_BYTES } from "@/lib/domain";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { securityEvent } from "@/lib/ratelimit";
import { removeStaffPhoto, signedStaffPhoto, uploadStaffPhoto } from "@/lib/staff-photo-storage";
import { staffGuard } from "@/lib/staff-api";

export const runtime="nodejs";
const id=z.uuid();
const MIME=new Set(["image/jpeg","image/png","image/webp"]);
const EXT:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};

export async function GET(req:Request){
  const traceId=traceIdFrom(req);
  const guard=await staffGuard(req,traceId,{mutation:false});
  if(guard.response)return guard.response;
  const parsed=id.safeParse(new URL(req.url).searchParams.get("staff_id"));
  if(!parsed.success)return err("invalid_input","Valid staff_id is required",400,traceId);
  if(guard.session.staff.role==="staff"&&guard.session.staff.id!==parsed.data)return err("forbidden","Not permitted",403,traceId);
  const [row]=await withStaff(guard.session,(tx)=>tx`select photo_storage_path from staff where id=${parsed.data}`);
  if(!row?.photo_storage_path)return new Response(null,{status:404});
  try{
    const url=await signedStaffPhoto(String(row.photo_storage_path));
    return Response.redirect(url,302);
  }catch(e){
    return err("storage_unavailable",e instanceof Error?e.message:"Unable to access staff photo",503,traceId);
  }
}

export async function POST(req:Request){
  const traceId=traceIdFrom(req);
  const guard=await staffGuard(req,traceId,{mutation:true});
  if(guard.response)return guard.response;
  const permission=await permissionFor(guard.session.staff.role,"manage_staff_profile");
  if(!permission.allowed){
    await securityEvent({event:"access_denied",staffId:guard.session.staff.id,ipHash:ipHash(req),route:new URL(req.url).pathname,detail:{action:"manage_staff_profile"},traceId});
    return err("forbidden","Your role does not allow staff profile management",403,traceId);
  }
  const form=await req.formData().catch(()=>null);
  const staffId=id.safeParse(form?.get("staff_id"));
  const file=form?.get("file");
  if(!staffId.success||!(file instanceof File))return err("invalid_input","staff_id and image file are required",400,traceId);
  if(file.size<=0||file.size>DOC_MAX_BYTES)return err("invalid_file","Image must be between 1 byte and 4 MB",400,traceId);
  if(!MIME.has(file.type))return err("invalid_file","Staff photo must be JPEG, PNG or WebP",400,traceId);

  const path=`staff/${staffId.data}/${randomUUID()}.${EXT[file.type]}`;
  try{
    await uploadStaffPhoto(path,new Uint8Array(await file.arrayBuffer()),file.type);
    let oldPath:string|null=null;
    await withStaff(guard.session,async(tx)=>{
      const [before]=await tx`select id,photo_storage_path from staff where id=${staffId.data} for update`;
      if(!before)throw new Error("STAFF_NOT_FOUND");
      oldPath=before.photo_storage_path?String(before.photo_storage_path):null;
      await tx`update staff set photo_storage_path=${path} where id=${staffId.data}`;
      await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
               values(null,'staff_profile_updated',${guard.session.staff.id},'staff',${staffId.data},
                      ${tx.json({photo_storage_path:oldPath})},${tx.json({photo_storage_path:path})},${traceId})`;
    });
    if(oldPath)await removeStaffPhoto(oldPath).catch((e)=>console.error("staff-photo-old-object-cleanup",e));
    return ok({staff_id:staffId.data,updated:true},200,traceId);
  }catch(e){
    await removeStaffPhoto(path).catch(()=>undefined);
    const message=e instanceof Error?e.message:"Staff photo update failed";
    if(message==="STAFF_NOT_FOUND")return err("not_found","Staff member not found",404,traceId);
    return err("staff_photo_failed",message,409,traceId);
  }
}
