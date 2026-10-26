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
    if (config.mode === 'editing') {
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const until = async check => { const started = performance.now(); while (!check()) { if (performance.now() - started > 30000) throw new Error('Editing UI timed out'); await wait(100); } };
      await until(() => document.querySelector('video')?.readyState >= 2);
      const add = async kind => { const select = document.querySelector('select[aria-label="Adicionar anotação"]'); select.value = kind; select.dispatchEvent(new Event('change', {bubbles:true})); await wait(200); };
      await add('text'); await add('arrow');
      assert(document.querySelectorAll('.video-viewport .preview-effect:not([hidden])').length === 2, 'Unselected annotations disappeared');
      await add('watermark');
      assert(document.querySelector('.scene > .preview-effect.watermark'), 'Watermark follows camera rather than canvas');
      const image = document.querySelector('.preview-effect.text img'); assert(image?.src.startsWith('data:image/png;base64,'), 'Text did not render');
      await wait(1000);
      document.querySelector('.header-actions .export-button').click(); await wait(200);
      document.querySelectorAll('.export-choice-grid button')[1].click(); document.querySelectorAll('.export-fps-grid button')[0].click(); await wait(100);
      document.querySelector('dialog.export-dialog button[type="submit"]').click();
      await until(() => (document.querySelector('.statusbar')?.textContent || '').includes('Exportação concluída:') || document.querySelector('.error-text')?.textContent);
      assert(!document.querySelector('.error-text')?.textContent, document.querySelector('.error-text')?.textContent);
      await invoke('report_preview_benchmark', {report:{phase:'editing',passed:true,annotations:3,preview:true,export:true}});
      label.textContent = 'Anotações, marca d’água, autosave e exportação passaram.';
      return;
    }
    if (config.mode === 'recording-settings') {
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const key = 'frame-studio-recording-options', previous = localStorage.getItem(key);
      const select = async (label, value) => {
        const node = document.querySelector(`select[aria-label="${label}"]`);
        assert(node && !node.matches(':disabled'), `Disabled or missing ${label} before opening a project`);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(node, value);
        node.dispatchEvent(new Event('change', {bubbles:true})); await wait(150);
        return node;
      };
      try {
        const devices = await invoke('list_recording_devices');
        document.querySelector('button[aria-label="Áudio"]').click(); await wait(400);
        await select('Tratamento da voz', 'natural');
        const checkbox = text => [...document.querySelectorAll('label')].find(label => label.textContent.trim().startsWith(text))?.querySelector('input[type="checkbox"]');
        assert(checkbox('Supressão de ruído')?.checked, 'Noise suppression not enabled in Natural');
        assert(checkbox('Compressor de voz')?.checked, 'Compressor not enabled in Natural');
        if (devices.inputs.length) await select('Microfone para gravar', devices.inputs[0].id);
        if (devices.outputs.length) await select('Saída de áudio a gravar', devices.outputs[0].id);
        const saved = JSON.parse(localStorage.getItem(key));
        assert(saved.microphoneProcessing.noiseSuppression && saved.microphoneProcessing.compressor, 'Voice preferences were not saved');
        assert(!devices.inputs.length || saved.microphoneDevice === devices.inputs[0].id, 'Microphone selection was not saved');
        assert(!devices.outputs.length || saved.outputDevice === devices.outputs[0].id, 'Output selection was not saved');
        await select('Tratamento da voz', 'off');
        assert(!checkbox('Supressão de ruído')?.checked && !checkbox('Compressor de voz')?.checked, 'Voice bypass failed');
        document.querySelector('button[aria-label="Webcam"]').click(); await wait(200);
        const camera = await select('Webcam para gravar', devices.cameras[0]?.id || '');
        assert(camera.options.length >= devices.cameras.length + 1, 'Cameras were not listed');
        await invoke('report_preview_benchmark', {report:{phase:'recording-settings',passed:true,outputs:devices.outputs.length,inputs:devices.inputs.length,cameras:devices.cameras.length,noiseSuppression:true,compressor:true,persistence:true,noProject:true}});
      } finally {
        if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
      }
      shield.remove(); return;
    }
    let video;
    for (let i = 0; i < 150; i++) { video = document.querySelector('video'); if (video?.readyState >= 2) break; await wait(200); }
    if (!video || video.readyState < 2) throw new Error(`Benchmark video did not load: ${JSON.stringify({src:video?.currentSrc,ready:video?.readyState,error:video?.error?.message,ui:document.querySelector('.error-text')?.textContent,body:!video?document.body.innerText.slice(0,1800):undefined})}`);
    if (config.mode === 'cursor-response') {
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const set = async (node, value) => {
        assert(node, 'Missing cursor response control');
        Object.getOwnPropertyDescriptor(node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(node, String(value));
        node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await wait(200);
      };
      document.querySelector('button[aria-label="Animações"]').click(); await wait(200);
      const select = name => document.querySelector(`select[aria-label="${name}"]`);
      const field = name => [...document.querySelectorAll('label')].find(n => n.textContent.trim().startsWith(name))?.querySelector('input');
      const slider = document.querySelector('[aria-label="Posição da reprodução"]');
      await set(slider, 1.1); video.pause(); await wait(300);
      await set(select('Resposta ao movimento'), 'off');
      const cursor = document.querySelector('.rendered-cursor');
      assert(cursor, 'Cursor overlay missing');
      const before = cursor.style.left + ':' + cursor.style.top;
      await set(select('Resposta ao movimento'), 'dynamic');
      assert(cursor.style.left + ':' + cursor.style.top !== before, 'Cursor shake did not reach the preview');
      await set(field('Intensidade do shake do cursor'), 0);
      assert(cursor.style.left + ':' + cursor.style.top === before, 'Zero intensity did not disable cursor shake');
      await set(field('Intensidade do shake do cursor'), 70);
      await set(select('Acompanhar cursor'), 'close');
      await set(field('Antecipação do zoom'), 25);
      assert(document.body.textContent.includes('Cliques preservados sempre'), 'Click preservation is not visible');
      const direction = field('Impacto ao mudar de direção'); direction.click(); await wait(200);
      await set(slider, 2.6); await wait(250);
      const still = cursor.style.left + ':' + cursor.style.top;
      await set(select('Resposta ao movimento'), 'off');
      assert(cursor.style.left + ':' + cursor.style.top === still, 'Stopped cursor still shakes');
      await set(select('Resposta ao movimento'), 'dynamic');
      await wait(1200);
      document.querySelector('.header-actions .export-button').click(); await wait(200);
      document.querySelectorAll('.export-choice-grid button')[1].click();
      document.querySelectorAll('.export-fps-grid button')[1].click(); await wait(100);
      document.querySelector('dialog.export-dialog button[type="submit"]').click();
      for (let i = 0; i < 300 && !(document.querySelector('.statusbar')?.textContent || '').includes('Exportação concluída:'); i++) {
        if (document.querySelector('.error-text')?.textContent) throw new Error(document.querySelector('.error-text').textContent);
        await wait(100);
      }
      assert((document.querySelector('.statusbar')?.textContent || '').includes('Exportação concluída:'), 'Cursor response export timed out');
      await invoke('report_preview_benchmark', { report: { phase: 'cursor-response', passed: true, preview: true, idle: true, controls: true, export: true } });
      shield.remove(); return;
    }
    if(config.mode==='cinematic-check'){
      const assert=(v,m)=>{if(!v)throw new Error(m);};
      const field=text=>[...document.querySelectorAll('label')].find(n=>n.textContent.trim().startsWith(text))?.querySelector('input,select');
      const set=async(node,value)=>{assert(node,'Missing control');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,String(value));node.dispatchEvent(new Event('input',{bubbles:true}));await wait(180);};
      const seek=async t=>{video.pause();await set(document.querySelector('[aria-label="Posição da reprodução"]'),t);await wait(200);};
      const click=text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);assert(b,`Missing ${text}`);b.click();};
      const bounds=()=>{const r=document.querySelector('.webcam-frame').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
      document.querySelector('button[aria-label="Animações"]').click();await wait(200);
      assert(document.querySelector('[aria-label="Motion Style"] button[aria-pressed="true"]').textContent==='Cinematic','Cinematic is not the default');
      await seek(1);click('Adicionar impacto no marcador');await wait(100);await seek(1.05);
      const viewport=document.querySelector('.video-viewport'),on=viewport.style.transform,webcam=bounds(),background=getComputedStyle(document.querySelector('.scene')).backgroundImage;
      const canvas=document.querySelector('.motion-preview'),scene=document.querySelector('.scene');assert(canvas.parentElement===scene,'Blur is still rasterized before the camera zoom');assert(canvas.width>=Math.round(scene.clientWidth*Math.min(devicePixelRatio,2))-1,'Blur canvas has insufficient final resolution');
      field('Micro-Shake').click();await wait(200);const off=viewport.style.transform;
      assert(on!==off,'Micro-shake did not move the rendered recording');
      const still=bounds();assert(Math.abs(webcam.x-still.x)<.02&&Math.abs(webcam.y-still.y)<.02,'Screen shake moved the webcam');
      assert(background===getComputedStyle(document.querySelector('.scene')).backgroundImage,'Shake changed the background');
      field('Micro-Shake').click();await wait(150);field('Micro-shake separado na webcam').click();await wait(150);
      const separate=bounds();assert(Math.abs(separate.x-webcam.x)+Math.abs(separate.y-webcam.y)>.01,'Separate webcam effect did not render');
      field('Micro-shake separado na webcam').click();await wait(100);
      click('Smooth');await wait(150);assert(!field('Micro-Shake').checked&&!field('Motion Blur').checked,'Smooth preset retained shake/blur');
      click('Dynamic');await wait(150);assert(field('Micro-Shake').checked&&field('Motion Blur').checked,'Dynamic preset failed');
      await set(field('Amortecimento'),110);assert(Number(field('Amortecimento').value)===110,'Damping control failed');
      click('Desativar Camera Motion');await wait(150);assert(!field('Micro-Shake').checked&&!field('Motion Blur').checked&&!field('Spring').checked,'Off left active effects');assert(document.querySelector('[aria-label="Impactos manuais"] button'),'Off deleted manual impacts');
      click('Cinematic');await wait(200);video.muted=true;
      const timestamps=[];let last=performance.now();await video.play();
      await new Promise(resolve=>{const start=performance.now();function tick(now){timestamps.push(now-last);last=now;if(now-start>=2000)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});video.pause();
      const sorted=[...timestamps].sort((a,b)=>a-b);const fps=timestamps.length/(timestamps.reduce((a,b)=>a+b,0)/1000);
      await invoke('report_preview_benchmark',{report:{phase:'cinematic-check',passed:true,on,off,webcamStable:true,separateWebcamEffect:true,backgroundStable:true,controls:true,fps,frameP95Ms:sorted[Math.floor(sorted.length*.95)]}});
      shield.remove();return;
    }
    if (config.mode === 'webcam-phase2') {
      const assert = (value,message) => {if(!value)throw new Error(message);};
      const field = text => [...document.querySelectorAll('label')].find(n=>n.textContent.trim().startsWith(text))?.querySelector('select,input');
      const set = async (node,value) => {assert(node,'Missing input');Object.getOwnPropertyDescriptor(node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(node,String(value));node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));await wait(180);};
      const seek = async t => {video.pause();await set(document.querySelector('[aria-label="Posição da reprodução"]'),t);await wait(450);};
      const width = () => document.querySelector('.webcam-frame').getBoundingClientRect().width;
      const clickText = text => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(text));assert(b,`Missing ${text}`);b.click();};
      document.querySelector('[aria-label="Webcam"]').click();await wait(300);
      await seek(0);const overview=width();
      await set(field('Tamanho durante zoom'),'shrink');await seek(2);const shrink=width();
      assert(Math.abs(shrink/overview-.65)<.015,'Shrink did not use effective focus');
      await seek(4);assert(Math.abs(width()-shrink)<1,'Focused camera size pulsed');
      await set(field('Tamanho durante zoom'),'grow');const grow=width();assert(Math.abs(grow/overview-1.35)<.015,'Grow failed');
      await set(field('Tamanho durante zoom'),'keep');assert(Math.abs(width()-overview)<1,'Keep failed');
      await set(field('Tamanho durante zoom'),'custom');await set(field('Tamanho em foco'),18);const custom=width();assert(Math.abs(custom/overview-.5)<.015,'Custom size failed');
      await seek(2);clickText('◇ Adicionar ajuste');await wait(200);
      assert(document.querySelectorAll('.webcam-keyframe').length===2,'Independent camera keys were not created');
      assert(Math.abs(width()-custom)<1,'Creating manual keyframe changed the displayed size');
      await set(field('Tamanho durante zoom'),'grow');
      assert(field('Animação').value==='manual','Global setting changed animation mode');
      assert(document.querySelectorAll('.webcam-keyframe').length===2,'Global setting created an accidental keyframe');
      assert(Math.abs(width()-custom)<1,'Automation overrode manual keyframe');
      await set(field('Curva da transição'),'cubic-bezier');
      clickText('Copiar estado');await seek(3);clickText('Colar estado');await wait(200);
      assert(document.querySelectorAll('.webcam-keyframe').length===3,'Paste did not create editable state');
      assert(field('Curva da transição').value==='cubic-bezier','Copy/paste discarded the selected easing');
      clickText('◆ Ajuste neste momento');await wait(200);assert(document.querySelectorAll('.webcam-keyframe').length===2,'Removing keyframe failed');
      await seek(0);const duration=field('Duração até o próximo');assert(duration,'Transition duration missing');
      duration.focus();await set(duration,1.5);duration.blur();await wait(200);
      await seek(1.5);assert(field('Tempo do keyframe'),'Duration did not retime the next keyframe');
      await invoke('report_preview_benchmark',{report:{phase:'webcam-phase2',passed:true,overview,shrink,grow,custom,keyframes:document.querySelectorAll('.webcam-keyframe').length,manualPriority:true,copyPasteRemove:true,retimedTo:1.5}});
      shield.remove();return;
    }
    if (config.mode === 'webcam-phase1') {
      const click = selector => { const node = document.querySelector(selector); if (!node || node.disabled) throw new Error(`Control unavailable: ${selector}`); node.click(); };
      const near = (a,b) => Math.abs(a-b)<1;
      const bounds = () => { const r=document.querySelector('.webcam-frame').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; };
      const gesture = async (node,dx,dy) => {
        const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
        node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:x,clientY:y,pointerId:1}));
        window.dispatchEvent(new PointerEvent('pointermove',{clientX:x+dx,clientY:y+dy,pointerId:1}));
        window.dispatchEvent(new PointerEvent('pointerup',{clientX:x+dx,clientY:y+dy,pointerId:1}));
        await wait(150);
      };
      video.pause();video.currentTime=Math.min(6.5,video.duration/2);
      click('[aria-label="Webcam"]');await wait(200);
      const camera=document.querySelector('.webcam-visual video');
      if(!camera)throw new Error('Project must contain a webcam track');
      for(let i=0;i<100&&camera.readyState<2;i++)await wait(50);
      camera.currentTime=video.currentTime;await wait(200);
      const before=bounds();
      await gesture(document.querySelector('.webcam-frame'),-35,-25);
      const moved=bounds();
      if(!near(moved.x,before.x-35)||!near(moved.y,before.y-25))throw new Error('Drag failed to update the visible camera');
      click('[aria-label="Desfazer"]');await wait(150);
      if(!near(bounds().x,before.x)||!near(bounds().y,before.y))throw new Error('Drag undo failed');
      await gesture(document.querySelector('.webcam-resize'),20,20);
      const resized=bounds();
      if(resized.width<before.width+10)throw new Error('Resize handle did not grow the camera');
      click('[aria-label="Desfazer"]');await wait(150);
      if(!near(bounds().width,before.width))throw new Error('Resize undo failed');
      click('[aria-label="Superior esquerdo"]');await wait(150);
      const corner=bounds(),scene=document.querySelector('.scene').getBoundingClientRect(),margin=Math.min(scene.width,scene.height)*.025;
      if(!near(corner.x,scene.x+margin)||!near(corner.y,scene.y+margin))throw new Error('Corner preset used incorrect margins');
      click('[aria-label="Desfazer"]');await wait(150);
      [...document.querySelectorAll('[aria-label="Formato da webcam"] button')].find(b=>b.textContent==='Original').click();await wait(150);
      const original=bounds();
      if(Math.abs(original.width/original.height-camera.videoWidth/camera.videoHeight)>.01)throw new Error('Original format distorted the webcam aspect');
      await invoke('report_preview_benchmark',{report:{phase:'webcam-phase1',passed:true,before,moved,resized,corner,original,sourceAspect:camera.videoWidth/camera.videoHeight}});
      shield.remove();return;
    }
    if (config.mode === 'cursor-visible' || config.checkCursor) {
      video.pause(); video.currentTime = Math.min(1, video.duration / 2); await wait(400);
      const cursor = document.querySelector('.rendered-cursor'), image = cursor?.querySelector('img');
      const state = () => ({src:image?.currentSrc,complete:image?.complete,width:image?.naturalWidth,display:cursor&&getComputedStyle(cursor).display,visibility:cursor&&getComputedStyle(cursor).visibility,bounds:cursor?.getBoundingClientRect().toJSON(),scene:document.querySelector('.scene')?.getBoundingClientRect().toJSON(),ui:document.querySelector('.error-text')?.textContent});
      if (!cursor || !image) throw new Error(`Cursor missing: ${JSON.stringify(state())}`);
      try { await image.decode(); } catch(e) { throw new Error(`Cursor asset failed: ${JSON.stringify(state())}: ${e}`); }
      if (!image.naturalWidth || getComputedStyle(cursor).display==='none') throw new Error(`Cursor invisible: ${JSON.stringify(state())}`);
      await invoke('report_preview_benchmark', {report:{phase:'cursor-visible',passed:true,...state()}});
      if (config.mode === 'cursor-visible') { shield.remove(); return; }
    }
    if (config.mode === 'cursor-quality') {
      video.pause(); video.currentTime = 0; await wait(300);
      const cursor = document.querySelector('.rendered-cursor'), image = cursor?.querySelector('img');
      if (!cursor || !image) throw new Error('Cursor overlay missing');
      await image.decode();
      const initialWidth = cursor.getBoundingClientRect().width;
      video.currentTime = 1.5; await wait(300);
      const viewport = document.querySelector('.video-viewport').getBoundingClientRect();
      const bounds = cursor.getBoundingClientRect();
      if (Math.max(image.naturalWidth,image.naturalHeight) < 1024) throw new Error('Low-resolution cursor loaded');
      if (cursor.closest('.media-plane')) throw new Error('Cursor still rasterized inside the camera layer');
      if (Math.abs(bounds.width / initialWidth - 3) > .01) throw new Error('Cursor size did not track camera zoom');
      if (Math.abs(bounds.x - viewport.x - viewport.width / 2) > 1 || Math.abs(bounds.y - viewport.y - viewport.height / 2) > 1) throw new Error('Cursor hotspot moved away from its source position');
      await invoke('report_preview_benchmark', {report:{phase:'cursor-quality',passed:true,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,zoomRatio:bounds.width/initialWidth}});
      shield.remove(); return;
    }
    if (config.mode === 'editing-check') {
      const click = (selector, text) => {
        const button = [...document.querySelectorAll(selector)].find(item => item.textContent.includes(text));
        if (!button || button.disabled) throw new Error(`Editing control unavailable: ${text}`);
        button.click();
      };
      video.pause(); video.currentTime = 1.5; await wait(200);
      click('.timeline-actions button', 'Dividir'); await wait(100);
      if (document.querySelectorAll('.clip-segment').length !== 2) throw new Error('Split did not create two clips');
      document.querySelector('.clip-segment').click(); await wait(100);
      click('.timeline-actions button', 'Apagar'); await wait(100);
      if (document.querySelectorAll('.clip-segment').length !== 1 || !document.querySelector('.transport').textContent.includes('0:01.500')) throw new Error('Deleted clip did not update the duration');
      document.querySelector('.zoom-block').click(); await wait(100);
      click('.timeline-actions button', 'Apagar'); await wait(100);
      if (document.querySelector('.zoom-block')) throw new Error('Selected zoom was not removed');
      document.querySelector('[aria-label="Desfazer"]').click(); await wait(100);
      if (!document.querySelector('.zoom-block')) throw new Error('Undo did not restore the zoom');
      document.querySelector('[aria-label="Desfazer"]').click(); await wait(100);
      if (document.querySelectorAll('.clip-segment').length !== 2 || !document.querySelector('.transport').textContent.includes('0:03.000')) throw new Error('Undo did not restore the deleted clip');
      document.querySelector('[aria-label="Refazer"]').click(); await wait(900);
      await invoke('report_preview_benchmark', {report:{phase:'editing-check',passed:true,clips:document.querySelectorAll('.clip-segment').length,zooms:document.querySelectorAll('.zoom-block').length}});
      shield.remove(); return;
    }
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
          const transform = document.querySelector('.video-viewport')?.style.transform;
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
      const form = document.querySelector('.export-dialog form');
      if (!form) throw new Error('Export options did not open');
      const options = form.querySelectorAll('select');
      for (const [index, value] of ['1080', '30'].entries()) {
        options[index].value = value;
        options[index].dispatchEvent(new Event('change', {bubbles: true}));
      }
      await wait(0);
      form.requestSubmit();
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
