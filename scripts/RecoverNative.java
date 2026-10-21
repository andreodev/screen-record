// Ghidra headless post-script. Static analysis only; never launches the target.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.address.Address;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class RecoverNative extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Path folder = Paths.get(args[0]); Files.createDirectories(folder);
        DecompInterface decompiler = new DecompInterface();
        decompiler.toggleCCode(true); decompiler.toggleSyntaxTree(false);
        if (!decompiler.openProgram(currentProgram)) throw new IOException(decompiler.getLastMessage());
        int ok=0, failed=0;
        try (PrintWriter index = new PrintWriter(Files.newBufferedWriter(folder.resolve("functions.tsv")))) {
            index.println("address\tstatus\tfile\tname");
            // The list contains only user-selected, named application functions.
            for (String line : Files.readAllLines(Paths.get(args[1]))) {
                if (monitor.isCancelled()) break;
                String[] parts = line.split("\t",2);
                Address address = toAddr(parts[0]);
                Function function = currentProgram.getFunctionManager().getFunctionAt(address);
                if (function==null) { index.println(parts[0]+"\tnot-analyzed\t\t"+parts[1]);failed++;continue; }
                DecompileResults result = decompiler.decompileFunction(function, 15, monitor);
                if (result.decompileCompleted() && result.getDecompiledFunction()!=null) {
                    String file=parts[0]+".c";
                    Files.writeString(folder.resolve(file), "/* Decompiled pseudocode; inferred types, not original Swift.\n"+parts[1].replace("*/","* /")+"\n*/\n"+result.getDecompiledFunction().getC());
                    index.println(parts[0]+"\tok\t"+file+"\t"+parts[1]);ok++;
                } else {index.println(parts[0]+"\tfailed\t\t"+parts[1]);failed++;}
                index.flush();
                if ((ok+failed)%20==0) println("RECOVERY_PROGRESS ok="+ok+" failed="+failed);
            }
        } finally {decompiler.dispose();}
        Files.writeString(folder.resolve("summary.txt"),"decompiled="+ok+"\nfailed="+failed+"\n");
        println("RECOVERY_COMPLETE ok="+ok+" failed="+failed);
    }
}
