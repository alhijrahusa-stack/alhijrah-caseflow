# Engine canary audio

`engine-canary-ar.mp3` holds the first 45 s of `Mutanabi_SalamaCast.mp3` from the Internet Archive
item `SalamaCast` (https://archive.org/details/SalamaCast), which is released under CC0 1.0
(public-domain dedication). The excerpt was cut with `ffmpeg -t 45 -c copy`, so the MPEG frames are
unchanged from the source.

The worker uses this real Arabic speech for the automatic engine self-test that proves each exact
local engine route works (engine version, model revision and decode configuration) before any
user recording is processed. It is not evidence and is never shown in recording lists.
