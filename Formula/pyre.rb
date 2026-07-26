class Pyre < Formula
  desc "Mac system monitoring CLI: temps, CPU, memory, disk, battery, live dashboard"
  homepage "https://github.com/somalip/pyre"
  url "https://github.com/somalip/pyre/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "--cache=#{buildpath}/.npm"
    system "npm", "run", "build"
    bin.install "dist/index.js" => "pyre"
  end

  test do
    assert_match "PYRE", shell_output("#{bin}/pyre --help")
  end
end
