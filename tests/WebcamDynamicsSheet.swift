import AppKit
let folder=CommandLine.arguments[1],aspect=CommandLine.arguments[2],behavior=CommandLine.arguments[3]
let cellW=aspect=="v" ? 240:360,cellH=aspect=="v" ? 427:203,rowH=cellH+38,w=cellW*3,h=rowH*2
let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:w,pixelsHigh:h,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
NSColor(calibratedWhite:0.07,alpha:1).setFill();NSRect(x:0,y:0,width:w,height:h).fill()
for (col,t) in ["0.5","2.5","4.5"].enumerated(){for(row,kind)in ["preview","export-view"].enumerated(){
 let y=h-(row+1)*rowH,file=folder+"/"+aspect+"-"+behavior+"-"+t+"-"+kind+".png"
 NSImage(contentsOfFile:file)!.draw(in:NSRect(x:col*cellW,y:y,width:cellW,height:cellH))
 let label=["Antes","Foco","Depois"][col]+" · "+(row==0 ? "Preview":"MP4")
 NSString(string:label).draw(at:NSPoint(x:col*cellW+8,y:y+cellH+12),withAttributes:[.font:NSFont.systemFont(ofSize:13,weight:.semibold),.foregroundColor:NSColor.white])
}}
NSGraphicsContext.restoreGraphicsState();try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:folder+"/"+aspect+"-"+behavior+"-comparison.png"))
