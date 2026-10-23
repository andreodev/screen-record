import AppKit
import WebKit
@MainActor final class Page: NSObject, WKNavigationDelegate {
 let view:WKWebView
 var finished:CheckedContinuation<Void,Never>?
 var failure:Error?
 override init(){view=WKWebView(frame:.zero);super.init();view.navigationDelegate=self}
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){finished?.resume();finished=nil}
 func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error){failure=error;finished?.resume();finished=nil}
 func render(_ html:String,_ output:String,_ width:Double,_ height:Double) async throws {
  view.frame=CGRect(x:0,y:0,width:width,height:height)
  let window=NSWindow(contentRect:view.frame,styleMask:[.borderless],backing:.buffered,defer:false);window.isReleasedWhenClosed=false;window.contentView=view;window.orderBack(nil)
  await withCheckedContinuation{finished=$0;view.loadFileURL(URL(fileURLWithPath:html),allowingReadAccessTo:URL(fileURLWithPath:"/"))}
  if let failure=failure{throw failure}
  try await Task.sleep(nanoseconds:300_000_000)
  let config=WKSnapshotConfiguration();config.rect=view.bounds;config.snapshotWidth=NSNumber(value:width)
  let image=try await view.takeSnapshot(configuration:config)
  let cg=image.cgImage(forProposedRect:nil,context:nil,hints:nil)!
  let context=CGContext(data:nil,width:Int(width),height:Int(height),bitsPerComponent:8,bytesPerRow:Int(width)*4,space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.draw(cg,in:CGRect(x:0,y:0,width:width,height:height))
  try NSBitmapImageRep(cgImage:context.makeImage()!).representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:output));window.close()
 }
}
@main struct Main {
 @MainActor static func main() async throws {
  _=NSApplication.shared;NSApp.setActivationPolicy(.accessory)
  let a=CommandLine.arguments;try await Page().render(a[1],a[2],Double(a[3])!,Double(a[4])!);print(a[2])
 }
}
