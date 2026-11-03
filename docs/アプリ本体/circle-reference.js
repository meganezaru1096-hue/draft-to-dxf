// Sample the aligned original drawing, never the colored selection overlay.
window.DraftCircleReference={
  raster(e){
    if(!e.background||e.selected.size<3||e.selected.size>4096)return {};
    const box=[Infinity,Infinity,-Infinity,-Infinity];
    for(const key of e.selected){const [pi,si]=key.split(':').map(Number),s=e.doc.paths[pi]?.segments[si];if(s?.type!=='line')return {};const b=e.bounds(s);box[0]=Math.min(box[0],b[0]);box[1]=Math.min(box[1],b[1]);box[2]=Math.max(box[2],b[2]);box[3]=Math.max(box[3],b[3]);}
    const padding=Math.max(3,.4*Math.max(box[2]-box[0],box[3]-box[1]));
    const x=Math.max(0,Math.floor(box[0]-padding)),y=Math.max(0,Math.floor(box[1]-padding));
    const width=Math.min(e.doc.width,Math.ceil(box[2]+padding))-x,height=Math.min(e.doc.height,Math.ceil(box[3]+padding))-y;
    if(width<1||height<1||width>512||height>512)return {};
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,width,height);c.translate(-x,-y);DraftRotation.drawBackground(e,c);
    return {circleRaster:{width,height,offset:[x,y]},pixels:c.getImageData(0,0,width,height).data.buffer};
  }
};
