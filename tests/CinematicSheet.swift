import AppKit
let folder=CommandLine.arguments[1],aspect=CommandLine.arguments[2]
let cellW=aspect=="v" ? 240:360,cellH=aspect=="v" ? 427:203,rowH=cellH+34,w=cellW*3,h=rowH*3
let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:w,pixelsHigh:h,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap);NSColor(calibratedWhite:0.07,alpha:1).setFill();NSRect(x:0,y:0,width:w,height:h).fill()
for(row,t)in ["00.8","02.9","06.5"].enumerated(){for(col,style)in ["off","cinematic","dynamic"].enumerated(){
 let y=h-(row+1)*rowH,file=folder+"/"+aspect+"-"+style+"/t-"+t+".png"
 NSImage(contentsOfFile:file)!.draw(in:NSRect(x:col*cellW,y:y,width:cellW,height:cellH))
 let label=["Zoom in","Pan / foco","Estabilizado"][row]+" · "+["Off","Cinematic","Dynamic"][col]
 NSString(string:label).draw(at:NSPoint(x:col*cellW+8,y:y+cellH+10),withAttributes:[.font:NSFont.systemFont(ofSize:12,weight:.semibold),.foregroundColor:NSColor.white])
}}
NSGraphicsContext.restoreGraphicsState();try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:folder+"/"+aspect+"-comparison.png"))
