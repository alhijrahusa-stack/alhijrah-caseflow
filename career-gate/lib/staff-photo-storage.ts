import "server-only";

const BUCKET="staff-assets";
const SIGNED_URL_SECONDS=600;

function config(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Supabase Storage is NOT_CONFIGURED");
  return{base:`${url.replace(/\/$/,"")}/storage/v1`,key};
}
const encodePath=(path:string)=>{
  if(path.split("/").some(seg=>seg===".."||seg==="."||seg===""))throw new Error("Invalid storage path");
  return path.split("/").map(encodeURIComponent).join("/");
};
const headers=(key:string,extra:Record<string,string>={})=>({Authorization:`Bearer ${key}`,apikey:key,...extra});
async function fail(res:Response,what:string):Promise<never>{const body=await res.text().catch(()=>"");throw new Error(`${what} failed (${res.status}) ${body.slice(0,200)}`)}

export async function uploadStaffPhoto(path:string,bytes:Uint8Array,contentType:string){
  const {base,key}=config();
  const res=await fetch(`${base}/object/${BUCKET}/${encodePath(path)}`,{method:"POST",headers:headers(key,{"Content-Type":contentType,"x-upsert":"false"}),body:Buffer.from(bytes),signal:AbortSignal.timeout(30_000)});
  if(!res.ok)await fail(res,"Staff photo upload");
}
export async function removeStaffPhoto(path:string){
  const {base,key}=config();
  const res=await fetch(`${base}/object/${BUCKET}`,{method:"DELETE",headers:headers(key,{"Content-Type":"application/json"}),body:JSON.stringify({prefixes:[path]}),signal:AbortSignal.timeout(30_000)});
  if(!res.ok)await fail(res,"Staff photo delete");
}
export async function signedStaffPhoto(path:string){
  const {base,key}=config();
  const res=await fetch(`${base}/object/sign/${BUCKET}/${encodePath(path)}`,{method:"POST",headers:headers(key,{"Content-Type":"application/json"}),body:JSON.stringify({expiresIn:SIGNED_URL_SECONDS}),signal:AbortSignal.timeout(30_000)});
  if(!res.ok)await fail(res,"Staff photo signed URL");
  const data=await res.json() as {signedURL?:string};
  if(!data.signedURL)throw new Error("Signed URL missing from Storage response");
  return `${base}${data.signedURL}`;
}
