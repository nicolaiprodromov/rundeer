## PHASE 1

1. Export node:

 - this node can export any data type to any file. for example the user can plug in a number/text or other text based outputs to export .txt or maybe .md or .json (the user chooses the extension), or maybe a video for mp4 (even thjough the user can choose extension we should only support mp4 for now) or maybe a png or jpg or webp or gif for images (support for png,jpg,webp,gif). input for what to export and input for name (plus extension). if a bundle of images/videos are provided they get exported separately (the node is smart to know and do this) and if an image bundle is provided the user has another 2 inputs with fps, and if fps is bigger than 0 image bundles get exported as mp4/gifs, and one with toggle between mp4 and gif, we can add one or two more sockets for gif/mp4 settings if you want and if needed.
 - operations category

## PHASE 2

1. Switch node:
 - this node can switch between 2 nodes of same data type, for now at least we only mix switch between same data type. 
 - operations category

2. Conditionals in the math node: we need less than, greater than, equal (with epsilon) and maybe some more useful math operations

3. mix node and the vector operation node (rename from simple Vector to Vector Op so there is no confusion with vector primitive) needs to be moved in the operations category

## PHASE 3

1. the prompt and prompt filter nodes need some improvement. so basically both need a run input so they can be triggered independently, they both need also xhigh as effort level (it stops at high but there is also xhigh).

## PHASE 4

1. we need to remove the `Number` node and replace it with `Integer` and `Float` primitive nodes. This also means that all nodes that use *number data* type must now choose to be either integer or float dependeing on what each node needs.

## PHASE 5
 
1. we need new string operations: `to_int` and `to_float` in the String Op node

## PHASE 6

1. color ramp node like in blender - look up on the internet how the color ramp node works and whats its for and we need to make an identical node in rundeer, we need to make it in the operations category and name it `Ramp` and it should render on demand not only when running the graph, so the user can tweak things

## PHASE 7

1. noise node like in blender - we need to look online to see exactly what parameters and how the noise is coded so we can get a super high quality noise node. - noise updates on demand so the user can tweak it visually. we put this new node in the Textures category

## PHASE 8

1. the compression node must have different compression methods (lossless is one that comes to mind what else can you think of? i also want a method that pixelates in a way, like if i turn the quality down to 0 it will show only 4 big pixels) and also it should work with uvs and images and videos. think of the compression methods list them and i will tell you what i want and we proceed from there

## PHASE 9

1. we need a new `Separate XYZ` node that can separate the components of a vector, but it should work with any visual data type, images, uvs, vectors whatever. while we do this can also make the `Separate RGB` node (with dropdown socket for HSV, oklch, HEX and if we need any other color type that you can think of) that separates into components based on the type chosen (for hsv is hue saturaion value, for hex is the hex code, for oklch is the components of oklch which i dont know).

## PHASE 10

1. 