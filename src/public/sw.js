const CACHE='caseflow-shell-v2.15.2';
const SHELL=['/','/app.css','/app.js','/manifest.webmanifest','/icon.svg'];
const SHELL_PATHS=new Set(SHELL);

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(
    event.request.method!=='GET'
    || url.origin!==self.location.origin
    || !SHELL_PATHS.has(url.pathname)
  ) return;

  event.respondWith(
    fetch(event.request)
      .then(response=>{
        if(response.ok){
          const copy=response.clone();
          event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));
        }
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
