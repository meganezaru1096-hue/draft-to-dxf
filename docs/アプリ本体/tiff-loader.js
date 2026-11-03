(() => {
  let active=null,generation=0;
  window.isDraftTiff=file=>/\.tiff?$/i.test(file.name)||/^image\/(?:x-)?tiff$/i.test(file.type);
  window.cancelTiffRead=()=>{generation++;active?.cancel();active=null;};
  window.renderLocalTiff=async(file,pageNumber)=>{
    cancelTiffRead();
    const request=generation;
    if(file.size>80*1024*1024)throw Error('TIFFは80MB以下で指定してください。');
    const bytes=await file.arrayBuffer();
    if(request!==generation)throw Error('TIFF読込を中止しました。');
    const result=await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(new Blob([window.tiffWorkerSource],{type:'text/javascript'})),worker=new Worker(url);
      let timer;const finish=(error,value)=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);if(active?.worker===worker)active=null;error?reject(error):resolve(value);};
      active={worker,cancel:()=>finish(Error('TIFF読込を中止しました。'))};
      timer=setTimeout(()=>finish(Error('TIFFの読込時間が上限を超えました。画像を確認してください。')),90000);
      worker.onerror=event=>{event.preventDefault();finish(Error('TIFFを読み込めません。画像が破損していないか確認してください。'));};
      worker.onmessage=({data})=>finish(data.error?Error(data.error):null,data);
      worker.postMessage({bytes,page:pageNumber},[bytes]);
    });
    const {width,height,orientation}=result,source=document.createElement('canvas');source.width=width;source.height=height;
    source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.rgba),width,height),0,0);
    let canvas=source;
    if(orientation!==1||!result.opaque){
      canvas=document.createElement('canvas');canvas.width=orientation>=5?height:width;canvas.height=orientation>=5?width:height;
      const matrices={1:[1,0,0,1,0,0],2:[-1,0,0,1,width,0],3:[-1,0,0,-1,width,height],4:[1,0,0,-1,0,height],5:[0,1,1,0,0,0],6:[0,1,-1,0,height,0],7:[0,-1,-1,0,height,width],8:[0,-1,1,0,0,width]};
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.setTransform(...matrices[orientation]);ctx.drawImage(source,0,0);ctx.resetTransform();source.width=source.height=0;
    }
    // Preserve one-byte grayscale input without a second full-size RGBA readback.
    if(orientation===1&&result.gray)canvas.draftGrayPixels=result.gray;
    canvas.draftDpi=result.dpi;document.getElementById('pageCount').textContent='全'+result.pages+'ページ';
    window.lastTiffRender={width:canvas.width,height:canvas.height,page:pageNumber,pages:result.pages,dpi:result.dpi,compression:result.compression,orientation};
    return canvas;
  };
})();
