// Legacy classification fields are accepted on input, but never hide or exclude geometry.
window.DraftPaths={
  normalize(paths){return Array.isArray(paths)?paths.map(p=>{if(!p||typeof p!=='object')return p;const {is_text,is_dimension,...geometry}=p;return geometry;}):paths;},
  project(project){const p={...project,paths:this.normalize(project.paths)};if(p.baselinePaths!==undefined)p.baselinePaths=this.normalize(p.baselinePaths);for(const key of ['showText','includeText','showDimensions','includeDimensions'])delete p[key];return p;}
};
