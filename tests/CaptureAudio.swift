@main struct CaptureAudioTest {
 static func main() async throws {
  let folder=URL(fileURLWithPath:CommandLine.arguments[1]);try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
  let pcmURL=folder.appendingPathComponent("voice.caf"),format=AVAudioFormat(standardFormatWithSampleRate:48000,channels:1)!
  let pcm=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:144000)!;pcm.frameLength=144000
  for i in 0..<144000 {pcm.floatChannelData![0][i]=Float(sin(Double(i)*880*2*Double.pi/48000))*0.15}
  var file:AVAudioFile?=try AVAudioFile(forWriting:pcmURL,settings:format.settings);try file!.write(from:pcm);file=nil
  let asset=AVURLAsset(url:pcmURL),reader=try AVAssetReader(asset:asset),track=try await asset.loadTracks(withMediaType:.audio).first!
  let output=AVAssetReaderTrackOutput(track:track,outputSettings:[AVFormatIDKey:kAudioFormatLinearPCM]);reader.add(output);reader.startReading()
  let recording=MicrophoneRecording(path:folder.appendingPathComponent("microphone.m4a").path),origin=CMTime(seconds:1000,preferredTimescale:48000)
  while let sample=output.copyNextSampleBuffer(){
   var timing=CMSampleTimingInfo();CMSampleBufferGetSampleTimingInfo(sample,at:0,timingInfoOut:&timing)
   let expected=timing.presentationTimeStamp.seconds+0.25
   timing.presentationTimeStamp=CMTimeAdd(timing.presentationTimeStamp,CMTime(seconds:1000.25,preferredTimescale:48000));var shifted:CMSampleBuffer?
   precondition(CMSampleBufferCreateCopyWithNewTiming(allocator:nil,sampleBuffer:sample,sampleTimingEntryCount:1,sampleTimingArray:&timing,sampleBufferOut:&shifted)==noErr)
   let adjusted=try relativeAudioSample(shifted!,origin:origin)!
   precondition(abs(CMSampleBufferGetPresentationTimeStamp(adjusted).seconds-expected)<1e-9)
   while recording.input?.isReadyForMoreMediaData==false {try await Task.sleep(nanoseconds:1_000_000)}
   try recording.append(shifted!,origin:origin)
  }
  try await recording.finish(at:CMTime(seconds:3.25,preferredTimescale:48000))
  let result=AVURLAsset(url:URL(fileURLWithPath:recording.path)),audio=try await result.loadTracks(withMediaType:.audio).first!,range=try await audio.load(.timeRange)
  precondition(range.start.seconds <= 0.25,"Audio starts after the captured timestamp")
  precondition(abs(CMTimeRangeGetEnd(range).seconds-3.25)<0.05,"Microphone duration drifted")
  print("Microphone retiming/encoding passed: host origin 1000s, preserved 250ms delay, 3.25s duration.")
 }
}
