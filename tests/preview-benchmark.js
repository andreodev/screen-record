(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const config = await invoke('benchmark_config');
  if (!config || window.__frameBenchmarkRunning) return;
  window.__frameBenchmarkRunning = true;
  const shield = document.createElement('div');
  Object.assign(shield.style, {position:'fixed',inset:'0',zIndex:'10000',display:'flex',alignItems:'flex-end',justifyContent:'center',padding:'40px',background:'transparent'});
  const status = document.createElement('div');
  Object.assign(status.style, {background:'#18151ff2',border:'1px solid #aa91ff',borderRadius:'10px',padding:'14px 20px',font:'13px -apple-system',color:'white',boxShadow:'0 5px 25px #0008'});
  const label = document.createElement('span'); label.textContent = 'Teste automático de desempenho — preparando…';
  const cancel = document.createElement('button'); cancel.textContent = 'Interromper teste'; cancel.style.marginLeft = '20px';
  let cancelled = false; cancel.onclick = () => { cancelled = true; };
  status.append(label, cancel); shield.append(status); document.body.append(shield);
  document.addEventListener('keydown', event => { event.preventDefault(); event.stopImmediatePropagation(); if (event.key === 'Escape') cancelled = true; }, true);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] || 0;
  try {
    let video;
    for (let i = 0; i < 150; i++) { video = document.querySelector('video'); if (video?.readyState >= 2) break; await wait(200); }
    if (!video || video.readyState < 2) throw new Error('Benchmark video did not load');
    video.muted = true;
    const measure = async (phase, seconds) => {
      const startUTC = Date.now(), start = performance.now(), intervals = [];
      const updateStatus = () => { label.textContent = `Teste automático · ${phase === 'playback' ? 'reprodução' : 'pausado'} · ${Math.max(0, Math.ceil(seconds - (performance.now()-start)/1000))}s restantes`; };
      updateStatus(); const statusTimer = setInterval(updateStatus, 1000);
      const quality = video.getVideoPlaybackQuality?.();
      let previous = start, previousTransform = '', changes = 0;
      if (phase !== 'playback') { for (let i=0; i<seconds; i++) { if (cancelled) throw new Error('Benchmark interrupted by user'); await wait(1000); } }
      else await new Promise((resolve, reject) => {
        function tick(now) {
          if (cancelled || video.paused || document.hidden) { reject(new Error(`Playback interrupted at ${video.currentTime.toFixed(2)}s; paused=${video.paused}, hidden=${document.hidden}`)); return; }
          intervals.push(now - previous); previous = now;
          const transform = document.querySelector('.media-plane')?.style.transform;
          if (transform !== previousTransform) { changes++; previousTransform = transform; }
          if (now - start >= seconds * 1000) resolve(); else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      clearInterval(statusTimer);
      const finalQuality = video.getVideoPlaybackQuality?.();
      const report = { phase, startUTC, endUTC: Date.now(), seconds: (performance.now() - start) / 1000,
        animationFrames: intervals.length, fps: intervals.length / ((performance.now() - start) / 1000),
        frameP50Ms: percentile(intervals, .5), frameP95Ms: percentile(intervals, .95),
        stallsOver50Ms: intervals.filter(n => n > 50).length, cameraUpdates: changes,
        decodedFrames: (finalQuality?.totalVideoFrames || 0) - (quality?.totalVideoFrames || 0),
        droppedVideoFrames: (finalQuality?.droppedVideoFrames || 0) - (quality?.droppedVideoFrames || 0),
        videoTime: video.currentTime, visibility: document.visibilityState };
      await invoke('report_preview_benchmark', { report });
    };
    video.pause(); video.currentTime = 0;
    await wait(1500);
    await measure('idle', config.idleSeconds || 20);
    if (config.mode === 'export') {
      const startUTC = Date.now(), start = performance.now();
      label.textContent = 'Teste automático · exportando os 10 minutos…';
      const exportButton = document.querySelector('.export-button');
      if (!exportButton) throw new Error('Export button not found');
      exportButton.click();
      for (;;) {
        if (cancelled) throw new Error('Benchmark interrupted by user');
        const error = document.querySelector('.error-text');
        if (error?.textContent) throw new Error(error.textContent);
        const status = document.querySelector('.statusbar')?.textContent || '';
        if (status.includes('Exportação concluída:')) break;
        if (performance.now() - start > 900000) throw new Error('Desktop export timeout');
        await wait(250);
      }
      await invoke('report_preview_benchmark', { report: {phase:'export',startUTC,endUTC:Date.now(),seconds:(performance.now()-start)/1000} });
      await measure('paused-after-playback', config.idleSeconds || 20);
      return;
    }
    const play = document.querySelector('button[aria-label="Reproduzir"]');
    if (!play) throw new Error('Play button not found');
    play.click();
    await wait(1000);
    if (video.paused) throw new Error('Video playback did not start');
    await measure('playback', Math.max(.1, Math.min(config.seconds || 600, video.duration - video.currentTime - .5)));
    video.pause();
    await measure('paused-after-playback', config.idleSeconds || 20);
  } catch (error) { await invoke('report_preview_benchmark', { report: { phase: 'error', message: String(error) } }); }
})();
