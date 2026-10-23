import AVFoundation
@main struct CheckCapturedAudio {
 static func main() async throws {
  let asset=AVURLAsset(url:URL(fileURLWithPath:CommandLine.arguments[1])),tracks=try await asset.loadTracks(withMediaType:.audio),duration=try await asset.load(.duration).seconds
  precondition(!tracks.isEmpty,"Audio track missing")
  let reader=try AVAssetReader(asset:asset),rate=48000.0
  let output=AVAssetReaderAudioMixOutput(audioTracks:tracks,audioSettings:[AVFormatIDKey:kAudioFormatLinearPCM,AVSampleRateKey:rate,AVNumberOfChannelsKey:1,AVLinearPCMIsFloatKey:true,AVLinearPCMBitDepthKey:32,AVLinearPCMIsNonInterleaved:false]);reader.add(output);reader.startReading()
  var values=[Float](repeating:0,count:Int(ceil(duration*rate))+48000)
  while let sample=output.copyNextSampleBuffer(){
   guard let block=CMSampleBufferGetDataBuffer(sample) else {continue}
   let bytes=CMBlockBufferGetDataLength(block);var chunk=[Float](repeating:0,count:bytes/4)
   _=chunk.withUnsafeMutableBytes{CMBlockBufferCopyDataBytes(block,atOffset:0,dataLength:bytes,destination:$0.baseAddress!)}
   let start=Int((CMSampleBufferGetPresentationTimeStamp(sample).seconds*rate).rounded())
   for (i,v) in chunk.enumerated() where start+i>=0 && start+i<values.count {values[start+i]=v}
  }
  precondition(reader.status == .completed,"Audio decode failed")
  func amplitude(_ time:Double,_ hz:Double)->Double{
   let start=Int(time*rate),count=4800;var real=0.0,imaginary=0.0
   for i in 0..<count {let v=Double(values[start+i]),phase=Double(i)*hz*2*Double.pi/rate;real+=v*cos(phase);imaginary+=v*sin(phase)}
   return 2*hypot(real,imaginary)/Double(count)
  }
  let report:[String:Any]=["duration":duration,"tracks":tracks.count,"early440":amplitude(0.03,440),"early880":amplitude(0.03,880),"tone440":amplitude(0.5,440),"tone880":amplitude(0.5,880)]
  print(String(data:try JSONSerialization.data(withJSONObject:report,options:.sortedKeys),encoding:.utf8)!)
 }
}
