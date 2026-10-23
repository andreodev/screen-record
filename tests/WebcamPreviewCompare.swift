import AppKit
func bitmap(_ path:String)throws->NSBitmapImageRep { NSBitmapImageRep(data:try Data(contentsOf:URL(fileURLWithPath:path)))! }
func rgb(_ im:NSBitmapImageRep,_ x:Int,_ y:Int)->[Double] { let c=im.colorAt(x:x,y:y)!.usingColorSpace(.sRGB)!;return [c.redComponent*255,c.greenComponent*255,c.blueComponent*255] }
let folder=CommandLine.arguments[1]
let cases=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:folder+"/frames.json"))) as! [[String:Any]]
var result=[[String:Any]]()
for item in cases {
 let name=item["name"] as! String,frame=item["frame"] as! [String:Double]
 let preview=try bitmap(folder+"/"+name+"-preview.png"),exported=try bitmap(folder+"/"+name+"-export-view.png")
 precondition(preview.pixelsWide==exported.pixelsWide && preview.pixelsHigh==exported.pixelsHigh)
 var inside=0.0,outside=0.0,ni=0,no=0
 for y in stride(from:0,to:preview.pixelsHigh,by:3) { for x in stride(from:0,to:preview.pixelsWide,by:3) {
  let a=rgb(preview,x,y),b=rgb(exported,x,y),delta=zip(a,b).map{abs($0-$1)}.reduce(0,+)/3
  if Double(x)>=frame["left"]! && Double(x)<frame["left"]!+frame["width"]! && Double(y)>=frame["top"]! && Double(y)<frame["top"]!+frame["height"]! {inside+=delta;ni+=1} else {outside+=delta;no+=1}
 }}
 let roi=inside/Double(max(1,ni)),background=outside/Double(max(1,no))
 print(name,String(format:"overlay RGB MAE %.3f/255; outside %.3f/255",roi,background))
 result.append(["name":name,"overlayMeanAbsoluteRGBError":roi,"outsideMeanAbsoluteRGBError":background])
 precondition(roi<8 && background<2,"Preview/export mismatch: \(name)")
}
try JSONSerialization.data(withJSONObject:result,options:.prettyPrinted).write(to:URL(fileURLWithPath:folder+"/pixel-comparison.json"))
