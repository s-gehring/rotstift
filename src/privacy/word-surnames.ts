export const WORD_SURNAMES: ReadonlySet<string> = new Set(
  `
adler alt amsel arm bach bachmann bär bauer baum baumann beck becker berg berger bergmann biber birke blank
blau blum blume bock bode böhm bote brand brandt braun brenner brückner buche busch dachs decker dietrich
dorn drossel eiche eisen engel ernst esel fahrenholz falk falke feld fink fischer fleischer frank franke
frei freitag freund frisch froh fröhlich frost fuchs fürst gärtner geiger gerber glaser glück gold graf
groß grün gut haas haase hahn hammer hart hartmann hase hecht heil held herbst herrmann herzog hirsch hirt
hoffmann hofmann holz horn huber hübner igel jäger jung kaiser kalk kamp kanne karpfen keller kellner kern
kessel kiefer klein kluge klug knecht koch köhler könig korn kraft kramer krämer kranich kraus krause krug
kühn kuhn kurz lamm lang lange laut lehmann lehmann licht linde löwe ludwig maier maler mann marx maurer
mayer meier meister metzger meyer mohn mond müller nagel neumann noack ochs otto pfeiffer pohl probst rabe
reich reh richter riemer ritter rose roth sand sattler sauer schäfer schaf scharf schlosser schmid schmidt
schmied schmitt schmitz schneider scholz schreiber schreiner schröder schubert schulte schulz schulze
schumacher schuster schwan schwarz schwab see seidel sommer sonne specht stahl stark stein stern still stock
stolz storch strauß sturm tanne thal tischler vogel vogt voigt wagner wahl wald walter weber weiß weiss
werner wild winkler winter wirt wolf wolff zander ziegler zimmermann
`
    .split(/\s+/u)
    .filter(Boolean),
);
