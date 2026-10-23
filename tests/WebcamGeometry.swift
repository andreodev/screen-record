@main struct WebcamGeometry {
 static func main() throws {
  let list = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String:Any]]
  for test in list {
   let c=test["camera"] as! [String:Any], f=test["frame"] as! [String:Double], width=test["width"] as! Double,height=test["height"] as! Double
   let state=WebcamKeyframe(t:0,x:c["x"] as! Double,y:c["y"] as! Double,size:c["size"] as! Double,opacity:nil,borderRadius:nil,easing:nil)
   let rect=webcamFrameRect(state,c["shape"] as! String,test["sourceAspect"] as! Double,width,height)
   precondition(abs(rect.minX-f["left"]!)<1e-8 && abs(height-rect.maxY-f["top"]!)<1e-8 && abs(rect.width-f["width"]!)<1e-8 && abs(rect.height-f["height"]!)<1e-8)
  }
  print("Preview/native webcam geometry matched in \(list.count) cases.")
 }
}
