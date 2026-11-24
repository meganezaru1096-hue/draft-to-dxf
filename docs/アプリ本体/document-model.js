// Legacy classification fields are accepted on input, but never hide or exclude geometry.
window.DraftLineStyle={solid:{label:'実線',color:'#d100b4',aci:7,name:'CONTINUOUS',pattern:[]},dashed:{label:'破線',color:'#008568',aci:3,name:'DASHED',pattern:[4,2]},dashdot:{label:'一点鎖線',color:'#bc6500',aci:1,name:'DASHDOT',pattern:[8,2,.4,2]},get(path){return this[path?.line_style||'solid']||this.solid;}};
window.DraftPaths={
  normalize(paths){return Array.isArray(paths)?paths.map(p=>{if(!p||typeof p!=='object')return p;const {is_text,is_dimension,...geometry}=p;return geometry;}):paths;},
  project(project){const p={...project,paths:this.normalize(project.paths)};if(p.baselinePaths!==undefined)p.baselinePaths=this.normalize(p.baselinePaths);for(const key of ['showText','includeText','showDimensions','includeDimensions'])delete p[key];return p;}
};
