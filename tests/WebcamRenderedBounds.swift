import AppKit
let folder=CommandLine.arguments[1]
let cases=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:folder+"/frames.json"))) as! [[String:Any]]
func image(_ path:String)->NSBitmapImageRep{NSBitmapImageRep(data:try! Data(contentsOf:URL(fileURLWithPath:path)))!}
func rgb(_ im:NSBitmapImageRep,_ x:Int,_ y:Int)->[Double]{let c=im.colorAt(x:x,y:y)!.usingColorSpace(.sRGB)!;return [c.redComponent,c.greenComponent,c.blueComponent]}
var reports=[[String:Any]](),failures=[String]()
for item in cases where (item["name"] as! String).contains("-shrink-") {
 let name=item["name"] as! String,t=item["t"] as! Double,f=item["frame"] as! [String:Double]
 let exported=image(folder+"/"+name+"-export-view.png"),baseline=image(folder+"/"+String(name.prefix(1))+"-base-view/t-"+String(format:"%04.1f",t)+".png")
 let left=f["left"]!,top=f["top"]!,width=f["width"]!,height=f["height"]!
 // Locate the sharp body boundary rather than counting the surrounding soft shadow.
 func edge(_ target:Double,_ horizontal:Bool)->Double {
  let radius=max(10,Int((horizontal ? width:height)*0.1)),limit=horizontal ? exported.pixelsWide:exported.pixelsHigh
  var best=0.0,position=0
  for candidate in max(1,Int(target)-radius)...min(limit-2,Int(target)+radius) {
   var strength=0.0,count=0
   let begin=horizontal ? top+height*0.3:left+width*0.3,end=horizontal ? top+height*0.7:left+width*0.7
   for line in stride(from:Int(begin),to:Int(end),by:2) {
    let a=rgb(exported,horizontal ? candidate-1:line,horizontal ? line:candidate-1),b=rgb(exported,horizontal ? candidate+1:line,horizontal ? line:candidate+1)
    let c=rgb(baseline,horizontal ? candidate-1:line,horizontal ? line:candidate-1),d=rgb(baseline,horizontal ? candidate+1:line,horizontal ? line:candidate+1)
    for i in 0..<3 {strength+=abs((b[i]-d[i])-(a[i]-c[i]))};count+=3
   }
   strength/=Double(count)
   if strength>best {best=strength;position=candidate}
  }
  precondition(best>0.015,"No visible camera boundary at \(name)")
  return Double(position)
 }
 let x0=edge(left,true),x1=edge(left+width,true),y0=edge(top,false),y1=edge(top+height,false)
 let measuredWidth=x1-x0,measuredHeight=y1-y0
 print(name,"expected",width,height,"measured",measuredWidth,measuredHeight);fflush(stdout)
 reports.append(["name":name,"expectedWidth":width,"expectedHeight":height,"measuredWidth":measuredWidth,"measuredHeight":measuredHeight])
 if abs(measuredWidth-width)>4 || abs(measuredHeight-height)>4 {failures.append(name)}
}
try JSONSerialization.data(withJSONObject:reports,options:.prettyPrinted).write(to:URL(fileURLWithPath:folder+"/rendered-bounds.json"))
precondition(failures.isEmpty,"Rendered bounds differ: \(failures)")
