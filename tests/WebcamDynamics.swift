@main struct WebcamDynamics {
 static func main() throws {
  // The fixture only needs scale; fill missing camera position for native keys.
  let raw=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))) as! [[String:Any]]
  for test in raw {
   let keys=(test["keys"] as! [[String:Any]]).map{Key(t:$0["t"] as! Double,x:0.5,y:0.5,scale:$0["scale"] as! Double,cut:$0["cut"] as? Bool)}
   let scale=webcamFocusScale(test["t"] as! Double,keys,test["duration"] as! Double)
   precondition(abs(webcamEase((test["t"] as! Double).truncatingRemainder(dividingBy:1),"cubic-bezier")-(test["bezier"] as! Double))<1e-10)
   let size=webcamZoomSize(0.32,scale,test["behavior"] as? String,0.16)
   precondition(abs(scale-(test["scale"] as! Double))<1e-10 && abs(size-(test["size"] as! Double))<1e-10)
   let motion = try JSONDecoder().decode(CameraMotion.self, from: JSONSerialization.data(withJSONObject: test["motion"]!))
   let moving=webcamMotionState(WebcamKeyframe(t:0,x:0.3,y:0.7,size:0.32,opacity:1,borderRadius:0.18,easing:nil),test["t"] as! Double,motion)
   let expected=test["webcamMotion"] as! [String:Double]
   precondition(abs(moving.x-expected["x"]!)<1e-10 && abs(moving.y-expected["y"]!)<1e-10)
   let manual=WebcamKeyframe(t:0,x:0.3,y:0.7,size:0.32,opacity:0.5,borderRadius:0.18,easing:nil)
   precondition(plannedWebcamState(manual,"manual",scale,"9:16","shrink",0.16,true).size==manual.size)
  }
  print("Native/preview webcam dynamics matched in \(raw.count) samples; manual priority passed.")
 }
}
