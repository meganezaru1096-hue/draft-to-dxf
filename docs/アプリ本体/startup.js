// Display actual boot stages, not a simulated percentage or artificial delay.
(() => {
  const screen=document.getElementById('startupScreen'),message=document.getElementById('startupMessage');
  const nodes=[...document.body.children].filter(n=>n!==screen&&!['SCRIPT','STYLE','LINK'].includes(n.tagName));
  const previous=nodes.map(n=>n.inert);nodes.forEach(n=>n.inert=true);
  const stages=['runtime','libraries','editor'];
  window.DraftStartup={
    stage(phase){const index=stages.indexOf(phase);if(index<0||screen.hidden)return;screen.dataset.phase=phase;message.textContent=['変換エンジンを準備しています','変換機能を読み込んでいます','編集画面を準備しています'][index];screen.querySelectorAll('[data-startup-step]').forEach((n,i)=>{n.dataset.state=i<index?'done':i===index?'active':'waiting';});},
    finish(){screen.hidden=true;nodes.forEach((n,i)=>n.inert=previous[i]);},
    fail(){if(screen.hidden)return;screen.dataset.failed='true';message.textContent='準備を完了できませんでした。画面を再読み込みしてください。';document.getElementById('startupRecovery').hidden=false;},
  };
  document.getElementById('startupReload').onclick=()=>location.reload();document.getElementById('startupDismiss').onclick=()=>DraftStartup.finish();
  window.addEventListener('error',()=>DraftStartup.fail());window.addEventListener('unhandledrejection',()=>DraftStartup.fail());
  DraftStartup.stage('runtime');
})();
