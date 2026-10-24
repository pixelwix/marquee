# Campaign progress companion

`campaign-progress.mjs` runs on the existing scripts-agent host, alongside
`agent.mjs`. It is not a Marquee background job. Install it beside the agent and
attach `campaignForJob(job.name, scriptsRoot)` as `campaignProgress` on the matching
job response. Read each summary once per job, then restart only scripts-agent.
Back up the agent and its catalog before installing. Do not modify campaign state.

The collector accepts the scripts root as an argument; no deployment address or
credential belongs in this repository. It reads existing movie and HEVC journals
and returns aggregate counts only. The Marquee owner-only scripts proxy provides
transport. It makes no service API calls and writes no files.

`npm test` covers count partitions, snapshot-bound verified movie completions,
missing data, stale timestamps, field allowlisting and escaped rendering. Marquee
falls back to the historical movie tracker when no movie search scope is enabled.
