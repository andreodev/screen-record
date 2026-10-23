@main struct BlurCompositing {
 static func main() {
  let context=CIContext(options:[.cacheIntermediates:false]),space=CGColorSpace(name:CGColorSpace.sRGB)!,rect=CGRect(x:0,y:0,width:1,height:1)
  func pixel(_ image:CIImage)->[UInt8] {
   var bytes=[UInt8](repeating:0,count:4)
   bytes.withUnsafeMutableBytes { context.render(image,toBitmap:$0.baseAddress!,rowBytes:4,bounds:rect,format:.RGBA8,colorSpace:space) }
   return bytes
  }
  for count in [3,5] {for alpha in [1.0,0.5] {
   let source=CIImage(color:CIColor(red:0.8,green:0.4,blue:0.2,alpha:alpha)).cropped(to:rect)
   var result:CIImage?
   for _ in 0..<count {result=accumulateMotionFrame(source,result,count)}
   let a=pixel(source),b=pixel(result!.applyingFilter("CISRGBToneCurveToLinear"))
   precondition(zip(a,b).allSatisfy{abs(Int($0)-Int($1))<=1},"Motion blur changed brightness/alpha: \(a) -> \(b)")
  }}
  let white=CIImage(color:CIColor.white).cropped(to:rect),black=CIImage(color:CIColor.black).cropped(to:rect)
  let average=accumulateMotionFrame(black,accumulateMotionFrame(white,nil,2),2).applyingFilter("CISRGBToneCurveToLinear")
  precondition(abs(Int(pixel(average)[0])-128)<=1,"Native blur must match Canvas2D sRGB averaging")
  print("Motion blur compositing preserves color/alpha and matches Canvas2D sRGB mixing.")
 }
}
