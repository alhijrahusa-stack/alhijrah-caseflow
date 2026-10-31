export function isEmploymentInterview(value:string){
  const normalized=value.trim().toLowerCase().replace(/[\s_-]+/g,' ');
  return ['employment interview','pre hire appointment','prehire appointment','amazon interview','مقابلة توظيف','مقابلة عمل'].includes(normalized);
}
